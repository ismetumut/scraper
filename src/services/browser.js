const puppeteer = require('puppeteer');

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  const headless = process.env.HEADLESS !== 'false';

  browserInstance = await puppeteer.launch({
    headless: headless ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,768',
      '--lang=en-US,en'
    ],
    defaultViewport: { width: 1366, height: 768 }
  });

  return browserInstance;
}

async function getAuthenticatedPage() {
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Anti-detection measures
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // Set LinkedIn cookies for authentication
  const liAt = process.env.LINKEDIN_SESSION_COOKIE;
  const csrfToken = process.env.LINKEDIN_CSRF_TOKEN;

  if (!liAt) {
    throw new Error('LINKEDIN_SESSION_COOKIE is not set. Please add your li_at cookie to .env');
  }

  await page.setCookie(
    {
      name: 'li_at',
      value: liAt,
      domain: '.linkedin.com',
      path: '/',
      httpOnly: true,
      secure: true
    },
    {
      name: 'JSESSIONID',
      value: csrfToken || `ajax:${Date.now()}`,
      domain: '.linkedin.com',
      path: '/',
      httpOnly: false,
      secure: true
    }
  );

  return page;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

module.exports = { getBrowser, getAuthenticatedPage, closeBrowser };
