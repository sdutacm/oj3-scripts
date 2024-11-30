const log4js = require('log4js');
const { isProd } = require('./env');

const options = {
  appenders: {
    console: {
      type: 'console',
    },
    file: {
      type: 'file',
      filename: 'logs/log.log',
    },
  },
  categories: {
    default: {
      appenders: ['console', 'file'],
      level: 'info',
    },
    dev: {
      appenders: ['console'],
      level: 'info',
    },
    prod: {
      appenders: ['console', 'file'],
      level: 'info',
    },
  },
};

if (global.loggerCategory) {
  options.appenders[`file-${global.loggerCategory}`] = {
    type: 'file',
    filename: `logs/${global.loggerCategory}.log`,
  };
  options.categories[global.loggerCategory] = {
    appenders: ['console', `file-${global.loggerCategory}`],
    level: 'info',
  };
}

log4js.configure(options);

function getDefaultLogger() {
  return log4js.getLogger(isProd ? 'prod' : 'dev');
}

function getCategoryLogger(schedule) {
  return log4js.getLogger(schedule);
}

const logger = global.loggerCategory
  ? getCategoryLogger(global.loggerCategory)
  : getDefaultLogger();

module.exports = {
  logger,
  getDefaultLogger,
  getCategoryLogger,
};
