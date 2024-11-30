const redis = require('redis');
const bluebird = require('bluebird');
const { isProd } = require('./env');
const { logger } = require('./logger');

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

function getOjRedisAgent(connOptions) {
  const redisConf = isProd
    ? require('../configs/oj-redis.prod')
    : require('../configs/oj-redis.dev');
  const redisClient = redis.createClient({
    ...redisConf,
    ...connOptions,
  });
  redisClient.on('error', function (err) {
    logger.error('[redis.error]', err);
  });

  return redisClient;
}

module.exports = {
  getOjRedisAgent,
};
