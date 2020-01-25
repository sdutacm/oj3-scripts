const log4js = require('log4js');
const path = require('path');

log4js.configure({
  appenders: {
    console: {
      type: 'console',
    },
    file: {
      type: 'file',
      filename: path.join(__dirname, '../logs/log.log'),
    },
    oj3RatingFile: {
      type: 'file',
      filename: path.join(__dirname, '../logs/oj3Rating.log'),
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
