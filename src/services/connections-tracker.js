const { scrapeConnections } = require('./connections-scraper');
const { closeBrowser } = require('./browser');
const { humanDelay } = require('../utils/delay');
const { loadTargets } = require('../utils/targets');
const {
  slugify,
  todayString,
  saveSnapshot,
  loadPreviousSnapshot,
  loadLatestSnapshot,
  listSnapshotDates,
  diffConnections
} = require('../utils/connections-store');

/**
 * Scrapes every tracked person, diffs against the previous snapshot to find
 * newly added connections, persists today's snapshot, and returns a report.
 *
 * @param {object} [options]
 * @param {Array} [options.targets] - override the configured targets
 * @returns {Promise<{date: string, reports: Array}>}
 */
async function runCheck(options = {}) {
  const targets = options.targets || loadTargets();
  const date = todayString();
  const reports = [];

  try {
    for (const target of targets) {
      const slug = slugify(target.name || target.profileUrl);
      try {
        const { connections } = await scrapeConnections(target.profileUrl);
        const previous = loadPreviousSnapshot(slug, date);
        const newConnections = diffConnections(
          previous ? previous.connections : [],
          connections
        );

        saveSnapshot(slug, {
          date,
          profileUrl: target.profileUrl,
          scrapedAt: new Date().toISOString(),
          connections
        });

        reports.push({
          name: target.name,
          slug,
          profileUrl: target.profileUrl,
          totalConnections: connections.length,
          newConnections,
          hasBaseline: !!previous
        });
      } catch (error) {
        reports.push({
          name: target.name,
          slug,
          profileUrl: target.profileUrl,
          error: error.message
        });
      }

      await humanDelay();
    }
  } finally {
    await closeBrowser().catch(() => {});
  }

  return { date, reports };
}

/**
 * Builds a report from stored snapshots only (no scraping). For each tracked
 * person it returns the new connections from the latest snapshot compared to
 * the one before it.
 */
function getStoredReports() {
  const targets = loadTargets();
  return targets.map(target => {
    const slug = slugify(target.name || target.profileUrl);
    const dates = listSnapshotDates(slug);
    const latest = loadLatestSnapshot(slug);

    if (!latest) {
      return {
        name: target.name,
        slug,
        profileUrl: target.profileUrl,
        totalConnections: 0,
        newConnections: [],
        lastChecked: null,
        snapshotCount: 0
      };
    }

    let newConnections = [];
    if (dates.length >= 2) {
      const prev = loadPreviousSnapshot(slug, dates[dates.length - 1]);
      newConnections = diffConnections(
        prev ? prev.connections : [],
        latest.connections
      );
    }

    return {
      name: target.name,
      slug,
      profileUrl: target.profileUrl,
      totalConnections: latest.connections.length,
      newConnections,
      lastChecked: latest.scrapedAt || latest.date,
      snapshotCount: dates.length
    };
  });
}

module.exports = { runCheck, getStoredReports };
