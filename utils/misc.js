const { logger } = require('./logger');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMain(main) {
  try {
    await main();
    await sleep(1000);
    process.exit(0);
  } catch (e) {
    logger.error('error:', e);
    await sleep(1000);
    process.exit(1);
  }
}

module.exports = {
  sleep,
  runMain,
};
