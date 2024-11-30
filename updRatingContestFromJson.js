global.loggerCategory = 'updRatingContestFromJson';

const fs = require('fs-extra');
const path = require('path');
const { logger } = require('./utils/logger');
const { getOjSqlAgent } = require('./utils/sql');
const { runMain } = require('./utils/misc');

const { query } = getOjSqlAgent();

const username2userIdMap = {};

async function queryOne(sql, params) {
  const res = await query(sql + ' LIMIT 1', params);
  if (res && res[0]) {
    return res[0];
  }
  return null;
}

async function findUserIdByUsername(username) {
  if (username2userIdMap[username]) {
    return username2userIdMap[username];
  }
  const res = await queryOne('SELECT user_id FROM user where binary user_name=?', [username]);
  if (res) {
    username2userIdMap[username] = res.user_id;
    return res.user_id;
  }
  return null;
}

async function updRatingContest(contestId) {
  logger.info(`contestId: ${contestId}`);
  let res;

  const ratingUntil = fs.readJsonSync(path.join(__dirname, 'data', 'rating', `sdut_rating_info_until_${contestId}.json`));
  const ratingChange = fs.readJsonSync(path.join(__dirname, 'data', 'rating', `sdut_rating_changes_${contestId}.json`));
  const usedRatingUntil = {};
  for (const username of Object.keys(ratingUntil)) {
    const r = ratingUntil[username];
    const userId = await findUserIdByUsername(username);
    usedRatingUntil[userId] = {
      rating: r.rating,
      ratingHistory: r.contests.map(c => ({
        contest: {
          contestId: c.cid,
          title: c.contest_name,
        },
        rank: c.rank,
        rating: c.rating,
        ratingChange: c.rating_change,
        date: c.date,
      })),
    };
  }
  const usedRatingChange = {};
  for (const contestUserId of Object.keys(ratingChange)) {
    const r = ratingChange[contestUserId];
    const username = r.user_name;
    const userId = await findUserIdByUsername(username);
    usedRatingChange[userId] = {
      rank: r.rank,
      oldRating: r.old_rating,
      newRating: r.new_rating,
      ratingChange: r.rating_change,
    };
  }
  fs.writeFileSync('conv1.json', JSON.stringify(usedRatingUntil, null, '  '));
  fs.writeFileSync('conv2.json', JSON.stringify(usedRatingChange, null, '  '));

  // 更新 DB
  await query(`INSERT INTO rating_contest SET contest_id=?, rating_until=?, rating_change=?, created_at=NOW(), updated_at=NOW()`, [
    contestId,
    JSON.stringify(usedRatingUntil),
    JSON.stringify(usedRatingChange),
  ]);
}

async function main() {
  logger.info('[updRatingContest.start]');
  const contestIds = (process.argv[2] || '').split(',');
  for (const contestId of contestIds) {
    await updRatingContest(contestId);
  }
}

runMain(main);
