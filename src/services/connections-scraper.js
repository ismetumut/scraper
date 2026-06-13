const { getAuthenticatedPage } = require('./browser');
const { humanDelay, randomDelay } = require('../utils/delay');
const { autoScroll } = require('../utils/scroll');

/**
 * Scrapes the public "connections" list of a 1st-degree connection
 * (only works if that person has set their connections visibility to public).
 *
 * @param {string} profileUrl - LinkedIn profile URL, e.g. https://www.linkedin.com/in/someone/
 * @param {object} options
 * @param {number} [options.maxPages] - max pages of results to scrape
 * @returns {Promise<{connections: Array, listUrl: string}>}
 */
async function scrapeConnections(profileUrl, options = {}) {
  const maxPages = options.maxPages || parseInt(process.env.CONNECTIONS_MAX_PAGES) || 10;

  let page;
  try {
    page = await getAuthenticatedPage();

    const connectionsUrl = buildConnectionsUrl(profileUrl);
    await page.goto(connectionsUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await randomDelay(3000, 5000);

    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
      throw new Error('Session expired. Please update your LinkedIn session cookie.');
    }

    const allConnections = [];
    const seen = new Set();

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      if (pageNum > 1) {
        const pageUrl = appendPageParam(page.url(), pageNum);
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await randomDelay(2000, 4000);
      }

      await autoScroll(page);
      await randomDelay(1000, 2000);

      const items = await extractConnectionsFromPage(page);

      let newOnPage = 0;
      for (const item of items) {
        const key = item.profileUrl || item.fullName;
        if (key && !seen.has(key)) {
          seen.add(key);
          allConnections.push(item);
          newOnPage++;
        }
      }

      console.log(`  📇 Page ${pageNum} - found ${items.length} entries (${newOnPage} new, total ${allConnections.length})`);

      // Stop early if a page returns nothing - no more results
      if (items.length === 0) {
        break;
      }

      if (pageNum < maxPages) {
        await humanDelay();
      }
    }

    return { connections: allConnections, listUrl: connectionsUrl };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * Derives the "connections" listing URL for a given profile URL.
 */
function buildConnectionsUrl(profileUrl) {
  const trimmed = profileUrl.trim().replace(/\/+$/, '');
  return `${trimmed}/connections/`;
}

/**
 * Appends/overrides the `page` query param on a URL.
 */
function appendPageParam(url, pageNum) {
  const u = new URL(url);
  u.searchParams.set('page', String(pageNum));
  return u.toString();
}

async function extractConnectionsFromPage(page) {
  return await page.evaluate(() => {
    const results = [];

    const selectors = [
      '.reusable-search__result-container',
      'li.reusable-search__result-container',
      '.entity-result',
      'li.mn-connection-card'
    ];

    let elements = [];
    for (const sel of selectors) {
      elements = document.querySelectorAll(sel);
      if (elements.length > 0) break;
    }

    elements.forEach((el) => {
      try {
        const nameEl = el.querySelector(
          '.entity-result__title-text a span[aria-hidden="true"], .entity-result__title-text a, .mn-connection-card__name, span[aria-hidden="true"]'
        );
        const fullName = nameEl ? nameEl.textContent.trim() : '';

        const profileLink = el.querySelector(
          'a.app-aware-link[href*="/in/"], a[href*="/in/"]'
        );
        let profileUrl = profileLink ? profileLink.href : '';
        // Strip tracking query params for stable comparisons
        if (profileUrl) {
          profileUrl = profileUrl.split('?')[0];
        }

        const headlineEl = el.querySelector(
          '.entity-result__primary-subtitle, .mn-connection-card__occupation'
        );
        const headline = headlineEl ? headlineEl.textContent.trim() : '';

        const locationEl = el.querySelector('.entity-result__secondary-subtitle');
        const location = locationEl ? locationEl.textContent.trim() : '';

        if (fullName && !fullName.toLowerCase().includes('linkedin member')) {
          results.push({ fullName, profileUrl, headline, location });
        }
      } catch (err) {
        // Skip problematic elements
      }
    });

    return results;
  });
}

module.exports = { scrapeConnections, buildConnectionsUrl };
