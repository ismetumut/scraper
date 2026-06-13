const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'connections');

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function personDir(slug) {
  const dir = path.join(DATA_DIR, slug);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function todayString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Saves today's snapshot of a person's connections list.
 */
function saveSnapshot(slug, snapshot) {
  const dir = personDir(slug);
  const filePath = path.join(dir, `${snapshot.date}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  return filePath;
}

/**
 * Returns the most recent snapshot strictly before `beforeDate` (YYYY-MM-DD),
 * or null if none exists.
 */
function loadPreviousSnapshot(slug, beforeDate) {
  const dir = personDir(slug);
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .filter(date => date < beforeDate)
    .sort();

  if (files.length === 0) return null;

  const latestDate = files[files.length - 1];
  const data = JSON.parse(fs.readFileSync(path.join(dir, `${latestDate}.json`), 'utf-8'));
  return data;
}

/**
 * Compares two connection lists and returns the entries that are new
 * in `current` compared to `previous`, matched by profileUrl (falling
 * back to fullName when profileUrl is missing).
 */
function diffConnections(previous, current) {
  const previousKeys = new Set(
    (previous || []).map(c => c.profileUrl || c.fullName)
  );

  return (current || []).filter(c => {
    const key = c.profileUrl || c.fullName;
    return key && !previousKeys.has(key);
  });
}

/**
 * Returns all snapshot dates for a person, sorted ascending (YYYY-MM-DD).
 */
function listSnapshotDates(slug) {
  const dir = personDir(slug);
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

/**
 * Loads a specific snapshot by date, or null if missing.
 */
function loadSnapshot(slug, date) {
  const dir = personDir(slug);
  const filePath = path.join(dir, `${date}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Loads the most recent snapshot for a person, or null if none exist.
 */
function loadLatestSnapshot(slug) {
  const dates = listSnapshotDates(slug);
  if (dates.length === 0) return null;
  return loadSnapshot(slug, dates[dates.length - 1]);
}

module.exports = {
  slugify,
  todayString,
  saveSnapshot,
  loadPreviousSnapshot,
  loadLatestSnapshot,
  loadSnapshot,
  listSnapshotDates,
  diffConnections
};
