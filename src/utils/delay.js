/**
 * Random delay between min and max ms to mimic human behavior
 */
function randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Delay with jitter for anti-detection
 */
function humanDelay() {
  const min = parseInt(process.env.SCRAPE_DELAY_MIN) || 2000;
  const max = parseInt(process.env.SCRAPE_DELAY_MAX) || 5000;
  return randomDelay(min, max);
}

module.exports = { randomDelay, humanDelay };
