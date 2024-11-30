const moment = require('moment');
require('moment/locale/zh-cn');

moment.locale('zh-cn');

function formatTime(momentObj) {
  return momentObj.format('YYYY-MM-DD HH:mm:ss');
}

module.exports = {
  moment,
  formatTime,
};
