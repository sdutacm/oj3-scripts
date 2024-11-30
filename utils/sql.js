// const mysql = require('mysql2');
const mysql = require('mysql2/promise');
const { isProd } = require('./env');
const { logger } = require('./logger');

const MAX_MYSQL_POOL_CONNECTION = 1;

function getOjSqlAgent(connOptions) {
  const dbConf = isProd ? require('../configs/oj-db.prod') : require('../configs/oj-db.dev');
  const conn = mysql.createPool({
    ...dbConf,
    waitForConnections: true,
    connectionLimit: MAX_MYSQL_POOL_CONNECTION,
    queueLimit: 0,
    ...connOptions,
  });

  async function query(sql, params) {
    const SQL = conn.format(sql, params);
    const _start = Date.now();
    const [rows] = await conn.query(SQL);
    !isProd && logger.info(`[sql (${Date.now() - _start}ms)]`, SQL);
    return rows;
  }

  return { conn, query };
}

module.exports = {
  getOjSqlAgent,
};
