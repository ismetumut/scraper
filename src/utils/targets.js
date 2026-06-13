const fs = require('fs');
const path = require('path');
const { slugify } = require('./connections-store');

const TARGETS_FILE = path.join(__dirname, '..', '..', 'config', 'connections-targets.json');

function ensureFile() {
  const dir = path.dirname(TARGETS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(TARGETS_FILE)) {
    fs.writeFileSync(TARGETS_FILE, '[]\n', 'utf-8');
  }
}

function loadTargets() {
  ensureFile();
  try {
    const raw = fs.readFileSync(TARGETS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveTargets(targets) {
  ensureFile();
  fs.writeFileSync(TARGETS_FILE, JSON.stringify(targets, null, 2) + '\n', 'utf-8');
}

/**
 * Adds a target if its profile URL isn't already tracked.
 * Returns { added: boolean, targets }.
 */
function addTarget(name, profileUrl) {
  const targets = loadTargets();
  const normalizedUrl = profileUrl.trim().replace(/\/+$/, '');

  const exists = targets.some(
    t => (t.profileUrl || '').trim().replace(/\/+$/, '') === normalizedUrl
  );
  if (exists) {
    return { added: false, targets };
  }

  targets.push({ name: name.trim(), profileUrl: normalizedUrl });
  saveTargets(targets);
  return { added: true, targets };
}

/**
 * Removes a target by its slug (derived from name/profileUrl).
 * Returns { removed: boolean, targets }.
 */
function removeTarget(slug) {
  const targets = loadTargets();
  const remaining = targets.filter(
    t => slugify(t.name || t.profileUrl) !== slug
  );
  const removed = remaining.length !== targets.length;
  if (removed) saveTargets(remaining);
  return { removed, targets: remaining };
}

module.exports = { loadTargets, saveTargets, addTarget, removeTarget, TARGETS_FILE };
