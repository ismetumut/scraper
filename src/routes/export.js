const express = require('express');
const router = express.Router();
const { loadResults } = require('../utils/store');

// GET /api/export/:jobId/csv - Export leads as CSV
router.get('/:jobId/csv', (req, res) => {
  const { jobId } = req.params;
  const data = loadResults(jobId);

  if (!data || !data.leads || data.leads.length === 0) {
    return res.status(404).json({ success: false, error: 'No data found for this job' });
  }

  const fields = [
    'fullName', 'firstName', 'lastName', 'title',
    'company', 'location', 'profileUrl', 'connectionDegree',
    'isPremium', 'scrapedAt'
  ];

  // Build CSV manually to avoid dependency issues
  const header = fields.join(',');
  const rows = data.leads.map(lead => {
    return fields.map(field => {
      const val = String(lead[field] || '').replace(/"/g, '""');
      return `"${val}"`;
    }).join(',');
  });

  const csv = [header, ...rows].join('\n');
  const filename = `${(data.listName || 'leads').replace(/[^a-zA-Z0-9]/g, '_')}_${jobId.slice(0, 8)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv); // BOM for Excel UTF-8
});

// GET /api/export/:jobId/json - Export leads as JSON
router.get('/:jobId/json', (req, res) => {
  const { jobId } = req.params;
  const data = loadResults(jobId);

  if (!data || !data.leads || data.leads.length === 0) {
    return res.status(404).json({ success: false, error: 'No data found for this job' });
  }

  const filename = `${(data.listName || 'leads').replace(/[^a-zA-Z0-9]/g, '_')}_${jobId.slice(0, 8)}.json`;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(data.leads);
});

module.exports = router;
