const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveResults(jobId, data) {
  const filePath = path.join(DATA_DIR, `${jobId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function loadResults(jobId) {
  const filePath = path.join(DATA_DIR, `${jobId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function listJobs() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
    return {
      jobId: f.replace('.json', ''),
      listName: data.listName || 'Unknown',
      listUrl: data.listUrl || '',
      totalLeads: (data.leads || []).length,
      status: data.status || 'unknown',
      createdAt: data.createdAt || null,
      completedAt: data.completedAt || null
    };
  });
}

module.exports = { saveResults, loadResults, listJobs };
