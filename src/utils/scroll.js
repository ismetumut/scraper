/**
 * Scrolls the page to the bottom to trigger lazy-loaded content
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);

      // Safety timeout
      setTimeout(() => {
        clearInterval(timer);
        resolve();
      }, 10000);
    });
  });
}

module.exports = { autoScroll };
