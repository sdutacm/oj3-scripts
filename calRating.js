global.loggerCategory = 'calRating';

const fs = require('fs-extra');
const path = require('path');
const _ = require('lodash');
const calculateRating = require('./libs/rating');
const { isProd } = require('./utils/env');
const { logger } = require('./utils/logger');
const { getOjSqlAgent } = require('./utils/sql');
const { getOjRedisAgent } = require('./utils/redis');
const { runMain } = require('./utils/misc');
const { moment } = require('./utils/datetime');

const { query } = getOjSqlAgent({ connectionLimit: 2 });
const redisClient = getOjRedisAgent();

const INIT_RATING = 1500;
const REDIS_STATUS_UPD_MIN_INTERVAL = 250;
const REDIS_STATUS_ENUM = {
  PD: 0,
  CAL: 1,
  DONE: 2,
  ERR: 3,
};

let isCompetition = false;

async function queryOne(sql, params) {
  const res = await query(sql + ' LIMIT 1', params);
  if (res && res[0]) {
    return res[0];
  }
  return null;
}

async function getRedisKey(key) {
  const res = await redisClient.getAsync(key);
  try {
    return JSON.parse(res);
  } catch (e) {
    return null;
  }
}

async function calRating(id) {
  const _calRatingStartAt = Date.now();
  let res;

  // 获取比赛详情
  res = await queryOne(
    isCompetition
      ? `SELECT * FROM competition WHERE competition_id=? AND ended=true`
      : `SELECT * FROM contest WHERE contest_id=? AND is_ended=true`,
    [id],
  );
  if (!res) {
    throw Error('no ended rating competition/contest found');
  }
  const detail = res;

  // 获取 rank data
  const rankData = await getRedisKey(
    isCompetition ? `temp:competition_rank_data:${id}` : `temp:contest_rank_data:${id}`,
  );
  if (!rankData) {
    throw Error('no redis rankdata found');
  }
  logger.info('found rankdata. users:', rankData.length);

  // 获取 old rating 从上一个 rating 赛
  res = await queryOne(`SELECT * FROM rating_contest ORDER BY rating_contest_id DESC`);
  logger.info(
    'using last rating contest:',
    JSON.stringify({
      rating_contest_id: res.rating_contest_id,
      contest_id: res.contest_id,
      competition_id: res.competition_id,
    }),
  );
  const oldTotalRatingMap = JSON.parse(_.get(res, 'rating_until', '{}'));
  if (Object.keys(oldTotalRatingMap).length === 0) {
    logger.warn('no old rating found');
  }

  // 计算 rating
  logger.info('cal rating...');
  const ratingUsers = rankData.map((r) => ({
    rank: r.rank,
    userId: r.userId,
    oldRating: _.get(oldTotalRatingMap, [r.userId, 'rating'], INIT_RATING),
  }));
  const redisStatusKey = isCompetition
    ? `status:competition_rating_status:${id}`
    : `status:contest_rating_status:${id}`;
  await redisClient.setAsync(
    redisStatusKey,
    JSON.stringify({
      status: REDIS_STATUS_ENUM.CAL,
      progress: 0,
    }),
  );
  let _lastUpdStatusAt = Date.now();
  const _algoCalRatingStartAt = Date.now();
  const calRatingUsers = await calculateRating({
    users: ratingUsers,
    onProgress: async (progress) => {
      const _now = Date.now();
      if (_now - _lastUpdStatusAt > REDIS_STATUS_UPD_MIN_INTERVAL) {
        _lastUpdStatusAt = _now;
        await redisClient.setAsync(
          redisStatusKey,
          JSON.stringify({
            status: REDIS_STATUS_ENUM.CAL,
            progress,
          }),
        );
        logger.info('update progress:', progress);
      }
    },
  });
  const algoCalRatingUsed = Date.now() - _algoCalRatingStartAt;

  // 计算总 rating（rating_until）和 rating change（rating_change）
  const newTotalRatingMap = { ...oldTotalRatingMap };
  const ratingChangeMap = {};
  for (const u of calRatingUsers) {
    const userId = u.userId;
    const ratingHistory = _.get(oldTotalRatingMap, [userId, 'ratingHistory'], []);
    ratingHistory.push(
      JSON.parse(
        JSON.stringify({
          contest: !isCompetition
            ? {
                contestId: id,
                title: detail.contest_name,
              }
            : undefined,
          competition: isCompetition
            ? {
                competitionId: id,
                title: detail.title,
              }
            : undefined,
          rank: u.rank,
          rating: u.newRating,
          ratingChange: u.delta,
          date: moment(isCompetition ? detail.start_at : detail.start_time).format('YYYY-MM-DD'),
        }),
      ),
    );
    newTotalRatingMap[userId] = {
      rating: u.newRating,
      ratingHistory,
    };
    ratingChangeMap[userId] = {
      rank: u.rank,
      oldRating: u.oldRating,
      newRating: u.newRating,
      ratingChange: u.delta,
    };
  }

  // fs.writeFileSync('tmp.json', JSON.stringify(calRatingUsers, null, '  '));
  // fs.writeFileSync('tmp1.json', JSON.stringify(newTotalRatingMap, null, '  '));
  // fs.writeFileSync('tmp2.json', JSON.stringify(ratingChangeMap, null, '  '));

  logger.info('cal rating done');

  // 更新 DB
  logger.info('update DB');
  for (const u of calRatingUsers) {
    const userId = u.userId;
    const { rating, ratingHistory } = newTotalRatingMap[userId];
    await query(`UPDATE user SET rating=?, rating_history=? WHERE user_id=?`, [
      rating,
      JSON.stringify(ratingHistory),
      userId,
    ]);
  }
  await query(
    `INSERT INTO rating_contest SET ${
      isCompetition ? 'competition_id' : 'contest_id'
    }=?, rating_until=?, rating_change=?, created_at=NOW(), updated_at=NOW()`,
    [id, JSON.stringify(newTotalRatingMap), JSON.stringify(ratingChangeMap)],
  );

  // 更新 Redis 状态
  logger.info('update Redis');
  await redisClient.setAsync(
    redisStatusKey,
    JSON.stringify({
      status: REDIS_STATUS_ENUM.DONE,
      progress: 100,
      used: algoCalRatingUsed,
      totalUsed: Date.now() - _calRatingStartAt,
    }),
  );

  // 清除 Redis 缓存
  logger.info('clear Redis cache');
  for (const ru of rankData) {
    await redisClient.delAsync(`cache:user_detail:${ru.userId}`);
    ru.contestUserId && (await redisClient.delAsync(`cache:contest_user_detail:${ru.contestUserId}`));
  }
  await redisClient.delAsync(
    isCompetition ? `cache:competition_ranklist:${id}` : `cache:contest_ranklist:${id}`,
  );
  await redisClient.delAsync(
    isCompetition
      ? `cache:rating_contest_detail_competition:${id}`
      : `cache:rating_contest_detail:${id}`,
  );

  // console.log('res', calRatingUsers);
  // logger.info('rankData', rankData);
  // 用 username 换关联用户的 OJ userId（之后可以用 userid1）代替
  // if (detail.type === 2) {
  //   // 注册比赛
  //   const contestUsers = await query('SELECT * FROM contest_user WHERE cid=? AND status=1', [id]);
  //   logger.info(`[calRating] contest users:`, contestUsers.length);
  //   const contestUsernames = contestUsers.map(cu => cu.user_name);
  //   const relativeUserInfo = await query('SELECT user_id, user_name FROM user where binary user_name IN (?)', [contestUsernames]);
  //   for (const cu of contestUsers) {
  //     const userInfo = relativeUserInfo.find(rui => rui.user_name === cu.user_name);
  //     if (userInfo) {
  //       cu.user_id = userInfo.user_id;
  //     } else {
  //       logger.error(`the OJ user info for username \`${cu.user_name}\` not found`);
  //       process.exit(1);
  //     }
  //   }
  // }

  // const tmp = {};
  // for (const rui of relativeUserInfo) {
  //   let has = 0;
  //   for (const cun of contestUsernames) {
  //     if (cun === rui.user_name) {
  //       tmp[cun] = [...(tmp[cun] || []), rui.user_id];
  //       has++;
  //     }
  //   }
  //   console.log(has, rui);
  // }
}

async function main() {
  const _startAt = Date.now();
  isCompetition = process.argv[2] === 'competition';
  const id = +process.argv[3];
  if (!id) {
    console.error('Usage: node calRating.js [competition|contest] <id>');
    process.exit(1);
  }
  logger.info('[oj3Rating.start]', new Date(), `isCompetition=${isCompetition}, id=${id}, isProd=${isProd}`);
  try {
    await calRating(id);
    logger.info(`[oj3Rating.done] ${Date.now() - _startAt}ms`);
  } catch (e) {
    const redisStatusKey = isCompetition
      ? `status:competition_rating_status:${id}`
      : `status:contest_rating_status:${id}`;
    await redisClient.setAsync(
      redisStatusKey,
      JSON.stringify({
        status: REDIS_STATUS_ENUM.ERR,
        progress: 0,
      }),
    );
    logger.error(`[oj3Rating.err] ${Date.now() - _startAt}ms`);
    throw e;
  }
}

runMain(main);
