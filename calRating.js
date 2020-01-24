const mysql = require('mysql2/promise');
const redis = require("redis");
const logger = require('./utils/logger');
const moment = require('moment');
const fs = require('fs-extra');
const calculateRating = require('./libs/rating');
const bluebird = require("bluebird");
const _ = require('lodash');
const { sleep } = require('./utils/common');
// require('moment/locale/zh-cn');

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);
// moment.locale('zh-cn');

const INIT_RATING = 1500;
const REDIS_STATUS_UPD_MIN_INTERVAL = 250;
const REDIS_STATUS_ENUM = {
  PD: 0,
  CAL: 1,
  DONE: 2,
  ERR: 3,
};

const isDev = process.env.NODE_ENV === 'development';
// const isDev = true;

const log = logger.getLogger(isDev ? 'dev' : 'oj3RatingProd');
let dbConf = {};
if (isDev) {
  dbConf = require('./configs/oj-db.dev');
} else {
  dbConf = require('./configs/oj-db.prod');
}

let conn;
let redisClient;

async function query(sql, params) {
  const SQL = conn.format(sql, params);
  isDev && log.info('[sql.start]', SQL);
  const _start = Date.now();
  const [rows] = await conn.query(SQL);
  isDev && log.info(`[sql.done]  ${Date.now() - _start}ms`);
  return rows;
}

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

async function init() {
  if (!conn) {
    conn = await mysql.createConnection(dbConf);
  }
  if (!redisClient) {
    redisClient = redis.createClient();
    redisClient.on('error', function (err) {
      log.error('[redis.error]', err);
    });
  }
}

async function calRating(contestId) {
  log.info(`contestId: ${contestId}`);
  const _calRatingStartAt = Date.now();
  await init();
  let res;

  // 获取比赛详情
  res = await queryOne(`SELECT * FROM contest WHERE contest_id=? AND end_time<NOW() AND mode=1`, [contestId]);
  if (!res) {
    throw Error('no ended rating contest found');
  }
  const contestDetail = res;

  // 获取 rank data
  const rankData = await getRedisKey(`temp:contest_rank_data:${contestId}`);
  if (!rankData) {
    throw Error('no redis rankdata found');
  }
  log.info('found rankdata. users:', rankData.length);

  // 获取 old rating 从上一个 rating 赛
  res = await queryOne(`SELECT * FROM rating_contest ORDER BY rating_contest_id DESC`);
  log.info('using last rating contest:', res && res.contest_id);
  const oldTotalRatingMap = JSON.parse(_.get(res, 'rating_until', '{}'));
  if (Object.keys(oldTotalRatingMap).length === 0) {
    log.warn('no old rating found');
  }
  
  // 计算 rating
  log.info('cal rating...');
  const ratingUsers = rankData.map(r => ({
    rank: r.rank,
    userId: r.userId,
    oldRating: _.get(oldTotalRatingMap, [r.userId, 'rating'], INIT_RATING),
  }));
  const redisStatusKey = `status:contest_rating_status:${contestId}`;
  await redisClient.setAsync(redisStatusKey, JSON.stringify({
    status: REDIS_STATUS_ENUM.CAL,
    progress: 0,
  }));
  let _lastUpdStatusAt = Date.now();
  const calRatingUsers = await calculateRating({
    users: ratingUsers,
    onProgress: async (progress) => {
      const _now = Date.now();
      if (_now - _lastUpdStatusAt > REDIS_STATUS_UPD_MIN_INTERVAL) {
        _lastUpdStatusAt = _now;
        await redisClient.setAsync(redisStatusKey, JSON.stringify({
          status: REDIS_STATUS_ENUM.CAL,
          progress,
        }));
        log.info('update progress:', progress);
      }
    },
  });

  // 计算总 rating（rating_until）和 rating change（rating_change）
  const newTotalRatingMap = { ...oldTotalRatingMap };
  const ratingChangeMap = {};
  for (const u of calRatingUsers) {
    const userId = u.userId;
    const ratingHistory = _.get(oldTotalRatingMap, [userId, 'ratingHistory'], []);
    ratingHistory.push({
      contest: {
        contestId,
        title: contestDetail.contest_name,
      },
      rank: u.rank,
      rating: u.newRating,
      ratingChange: u.delta,
      date: moment(contestDetail.start_time).format('YYYY-MM-DD'),
    });
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

  fs.writeFileSync('tmp.json', JSON.stringify(calRatingUsers, null, '  '));
  fs.writeFileSync('tmp1.json', JSON.stringify(newTotalRatingMap, null, '  '));
  fs.writeFileSync('tmp2.json', JSON.stringify(ratingChangeMap, null, '  '));

  log.info('cal rating done');
  // 更新 DB
  for (const u of calRatingUsers) {
    const userId = u.userId;
    const { rating, ratingHistory } = newTotalRatingMap[userId];
    await query(`UPDATE user SET rating=?, rating_history=? WHERE user_id=?`, [
      rating,
      JSON.stringify(ratingHistory),
      userId,
    ]);
  }
  await query(`INSERT INTO rating_contest SET contest_id=?, rating_until=?, rating_change=?, created_at=NOW(), updated_at=NOW()`, [
    contestId,
    JSON.stringify(newTotalRatingMap),
    JSON.stringify(ratingChangeMap),
  ]);

  // 更新 Redis 状态
  await redisClient.setAsync(redisStatusKey, JSON.stringify({
    status: REDIS_STATUS_ENUM.DONE,
    progress: 100,
    used: Date.now() - _calRatingStartAt,
  }));
  
  // console.log('res', calRatingUsers);
  // log.info('rankData', rankData);
  // 用 username 换关联用户的 OJ userId（之后可以用 userid1）代替
  // if (contestDetail.type === 2) {
  //   // 注册比赛
  //   const contestUsers = await query('SELECT * FROM contest_user WHERE cid=? AND status=1', [contestId]);
  //   log.info(`[calRating] contest users:`, contestUsers.length);
  //   const contestUsernames = contestUsers.map(cu => cu.user_name);
  //   const relativeUserInfo = await query('SELECT user_id, user_name FROM user where binary user_name IN (?)', [contestUsernames]);
  //   for (const cu of contestUsers) {
  //     const userInfo = relativeUserInfo.find(rui => rui.user_name === cu.user_name);
  //     if (userInfo) {
  //       cu.user_id = userInfo.user_id;
  //     } else {
  //       log.error(`the OJ user info for username \`${cu.user_name}\` not found`);
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
  log.info('[oj3Rating.start]');
  const contestId = +process.argv[2];
  if (!contestId) {
    log.error('invalid contest id');
    process.exit(1);
  }
  try {
    await calRating(contestId);
    await log.info(`[oj3Rating.done] ${Date.now() - _startAt}ms`);
  } catch (e) {
    const redisStatusKey = `status:contest_rating_status:${contestId}`;
    await redisClient.setAsync(redisStatusKey, JSON.stringify({
      status: REDIS_STATUS_ENUM.ERR,
      progress: 0,
    }));
    await log.error(e);
  }
  await sleep(2000);
  process.exit(0);
}

main();
