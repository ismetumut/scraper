const { getAuthenticatedPage } = require('./browser');
const { humanDelay, randomDelay } = require('../utils/delay');
const { saveResults } = require('../utils/store');

// Active scraping jobs tracker
const activeJobs = new Map();

function getJobStatus(jobId) {
  return activeJobs.get(jobId) || null;
}

function getAllActiveJobs() {
  return Array.from(activeJobs.entries()).map(([id, job]) => ({
    jobId: id,
    ...job
  }));
}

/**
 * Main scraper: extracts leads from a Sales Navigator saved list
 */
async function scrapeList(jobId, listUrl, options = {}) {
  const maxPages = options.maxPages || parseInt(process.env.MAX_PAGES_PER_RUN) || 25;

  activeJobs.set(jobId, {
    status: 'starting',
    listUrl,
    listName: '',
    progress: 0,
    totalPages: 0,
    currentPage: 0,
    leadsFound: 0,
    errors: [],
    createdAt: new Date().toISOString()
  });

  let page;
  const allLeads = [];

  try {
    page = await getAuthenticatedPage();

    // Navigate to the list
    activeJobs.get(jobId).status = 'navigating';
    await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await randomDelay(3000, 5000);

    // Check if we're on a valid Sales Navigator page
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
      throw new Error('Session expired. Please update your LinkedIn session cookie.');
    }

    // Get list name
    const listName = await extractListName(page);
    activeJobs.get(jobId).listName = listName;

    // Get total results count
    const totalCount = await extractTotalCount(page);
    const totalPages = Math.min(Math.ceil(totalCount / 25), maxPages);
    activeJobs.get(jobId).totalPages = totalPages;
    activeJobs.get(jobId).status = 'scraping';

    console.log(`📋 List: "${listName}" | Total leads: ${totalCount} | Pages to scrape: ${totalPages}`);

    // Scrape each page
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        activeJobs.get(jobId).currentPage = pageNum;
        activeJobs.get(jobId).progress = Math.round((pageNum / totalPages) * 100);

        if (pageNum > 1) {
          const pageUrl = `${listUrl}&page=${pageNum}`;
          await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
          await randomDelay(2000, 4000);
        }

        // Scroll down to load all results
        await autoScroll(page);
        await randomDelay(1000, 2000);

        // Extract leads from current page
        const leads = await extractLeadsFromPage(page, pageNum);
        allLeads.push(...leads);

        activeJobs.get(jobId).leadsFound = allLeads.length;
        console.log(`  ✅ Page ${pageNum}/${totalPages} - Found ${leads.length} leads (Total: ${allLeads.length})`);

        // Human-like delay between pages
        if (pageNum < totalPages) {
          await humanDelay();
        }
      } catch (pageError) {
        console.error(`  ❌ Error on page ${pageNum}:`, pageError.message);
        activeJobs.get(jobId).errors.push({
          page: pageNum,
          error: pageError.message
        });
      }
    }

    // Save results
    const result = {
      jobId,
      listName,
      listUrl,
      status: 'completed',
      totalLeads: allLeads.length,
      leads: allLeads,
      createdAt: activeJobs.get(jobId).createdAt,
      completedAt: new Date().toISOString()
    };

    saveResults(jobId, result);

    activeJobs.get(jobId).status = 'completed';
    activeJobs.get(jobId).leadsFound = allLeads.length;
    activeJobs.get(jobId).progress = 100;
    activeJobs.get(jobId).completedAt = result.completedAt;

    console.log(`\n🎉 Scraping complete! ${allLeads.length} leads extracted from "${listName}"`);

    return result;
  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
    activeJobs.get(jobId).status = 'failed';
    activeJobs.get(jobId).errors.push({ error: error.message });

    const failResult = {
      jobId,
      listName: activeJobs.get(jobId).listName,
      listUrl,
      status: 'failed',
      totalLeads: allLeads.length,
      leads: allLeads,
      error: error.message,
      createdAt: activeJobs.get(jobId).createdAt,
      completedAt: new Date().toISOString()
    };
    saveResults(jobId, failResult);

    return failResult;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

async function extractListName(page) {
  try {
    return await page.$eval(
      'h1, [data-anonymize="person-name"], .artdeco-typography--title1',
      el => el.textContent.trim()
    );
  } catch {
    return 'Sales Navigator List';
  }
}

async function extractTotalCount(page) {
  try {
    const countText = await page.$eval(
      '.artdeco-typography--body-small, [data-test-results-count], .search-results__total',
      el => el.textContent.trim()
    );
    const match = countText.match(/[\d,]+/);
    return match ? parseInt(match[0].replace(/,/g, '')) : 0;
  } catch {
    return 100; // fallback
  }
}

async function extractLeadsFromPage(page, pageNum) {
  return await page.evaluate((currentPage) => {
    const leads = [];
    // Sales Navigator lead result selectors
    const selectors = [
      'li.artdeco-list__item',
      '[data-x--lead-card]',
      '.search-results__result-item',
      'ol.search-results__result-list > li',
      '.artdeco-entity-lockup'
    ];

    let resultElements = [];
    for (const sel of selectors) {
      resultElements = document.querySelectorAll(sel);
      if (resultElements.length > 0) break;
    }

    resultElements.forEach((el, index) => {
      try {
        // Extract name
        const nameEl = el.querySelector(
          '[data-anonymize="person-name"], .artdeco-entity-lockup__title a, a[data-control-name="view_lead"], .result-lockup__name a'
        );
        const fullName = nameEl ? nameEl.textContent.trim() : '';

        // Extract profile URL
        const profileLink = el.querySelector(
          'a[href*="/sales/lead/"], a[href*="/in/"], .artdeco-entity-lockup__title a'
        );
        const profileUrl = profileLink ? profileLink.href : '';

        // Extract title / headline
        const titleEl = el.querySelector(
          '[data-anonymize="title"], .artdeco-entity-lockup__subtitle, .result-lockup__highlight-keyword'
        );
        const title = titleEl ? titleEl.textContent.trim() : '';

        // Extract company
        const companyEl = el.querySelector(
          '[data-anonymize="company-name"], .artdeco-entity-lockup__caption, a[data-control-name="view_company"]'
        );
        const company = companyEl ? companyEl.textContent.trim() : '';

        // Extract location
        const locationEl = el.querySelector(
          '[data-anonymize="location"], .artdeco-entity-lockup__metadata, .result-lockup__misc-item'
        );
        const location = locationEl ? locationEl.textContent.trim() : '';

        // Extract connection degree
        const degreeEl = el.querySelector(
          '.artdeco-entity-lockup__degree, .result-lockup__badge, [data-test-badge]'
        );
        const connectionDegree = degreeEl ? degreeEl.textContent.trim() : '';

        // Extract premium/InMail status
        const premiumEl = el.querySelector('.li-icon--premium, [data-test-premium]');
        const isPremium = !!premiumEl;

        if (fullName) {
          leads.push({
            fullName,
            firstName: fullName.split(' ')[0] || '',
            lastName: fullName.split(' ').slice(1).join(' ') || '',
            title,
            company,
            location,
            profileUrl,
            connectionDegree,
            isPremium,
            scrapedPage: currentPage,
            scrapedIndex: index + 1,
            scrapedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        // Skip problematic elements
      }
    });

    return leads;
  }, pageNum);
}

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

/**
 * Scrape saved lists overview from Sales Navigator
 */
async function scrapeSavedLists() {
  let page;
  try {
    page = await getAuthenticatedPage();
    await page.goto('https://www.linkedin.com/sales/lists/people', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    await randomDelay(3000, 5000);

    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
      throw new Error('Session expired. Please update your LinkedIn session cookie.');
    }

    await autoScroll(page);
    await randomDelay(1000, 2000);

    const lists = await page.evaluate(() => {
      const items = [];
      const rows = document.querySelectorAll(
        'tr, li.artdeco-list__item, [data-test-list-row], .lists-nav__list-item'
      );

      rows.forEach(row => {
        try {
          const nameEl = row.querySelector(
            'a[href*="/sales/lists/people/"], a[href*="/sales/list/"], .lists-nav__list-item-text'
          );
          const countEl = row.querySelector(
            'td:nth-child(2), .lists-nav__list-item-count, [data-test-list-count]'
          );

          if (nameEl) {
            const name = nameEl.textContent.trim();
            const url = nameEl.href || '';
            const countText = countEl ? countEl.textContent.trim() : '0';
            const count = parseInt(countText.replace(/[^\d]/g, '')) || 0;

            items.push({ name, url, leadCount: count });
          }
        } catch (err) {}
      });

      return items;
    });

    return lists;
  } catch (error) {
    throw error;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

module.exports = {
  scrapeList,
  scrapeSavedLists,
  getJobStatus,
  getAllActiveJobs
};
