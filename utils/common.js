function sleep(ms) {
  return new Promise((rs, rj) => {
    setTimeout(() => rs(), ms);
  });
}

module.exports = {
  sleep,
};
