const log4js = require('log4js');

log4js.configure({
  appenders: {
    console: {
      type: 'console',
    },
    file: {
      type: 'file',
      filename: 'logs/log.log',
    },
    oj3RatingFile: {
      type: 'file',
      filename: 'logs/oj3Rating.log',
    },
  },
  categories: {
    default: {
      appenders: ['console', 'file'],
      level: 'info'
    },
    dev: {
      appenders: ['console'],
      level: 'info'
    },
    oj3RatingProd: {
      appenders: ['console', 'oj3RatingFile'],
      level: 'info'
    },
  }
});

module.exports = log4js;
