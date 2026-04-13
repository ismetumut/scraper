const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { scrapeList, scrapeSavedLists, getJobStatus, getAllActiveJobs } = require('../services/navigator-scraper');
const { listJobs, loadResults } = require('../utils/store');

// GET /api/scraper/lists - Fetch saved lists from Sales Navigator
router.get('/lists', async (req, res) => {
  try {
    const lists = await scrapeSavedLists();
    res.json({ success: true, lists });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/scraper/start - Start scraping a list
router.post('/start', async (req, res) => {
  const { listUrl, maxPages } = req.body;

  if (!listUrl) {
    return res.status(400).json({ success: false, error: 'listUrl is required' });
  }

  // Validate URL format
  if (!listUrl.includes('linkedin.com/sales/')) {
    return res.status(400).json({
      success: false,
      error: 'Invalid URL. Must be a LinkedIn Sales Navigator list URL.'
    });
  }

  const jobId = uuidv4();

  // Start scraping in background (non-blocking)
  scrapeList(jobId, listUrl, { maxPages: maxPages || undefined });

  res.json({
    success: true,
    jobId,
    message: 'Scraping started. Use /api/scraper/status/:jobId to track progress.'
  });
});

// GET /api/scraper/status/:jobId - Get job status
router.get('/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const status = getJobStatus(jobId);

  if (!status) {
    // Check stored results
    const stored = loadResults(jobId);
    if (stored) {
      return res.json({
        success: true,
        job: {
          jobId,
          status: stored.status,
          listName: stored.listName,
          listUrl: stored.listUrl,
          leadsFound: stored.totalLeads,
          progress: 100,
          createdAt: stored.createdAt,
          completedAt: stored.completedAt
        }
      });
    }
    return res.status(404).json({ success: false, error: 'Job not found' });
  }

  res.json({ success: true, job: { jobId, ...status } });
});

// GET /api/scraper/results/:jobId - Get scraped leads
router.get('/results/:jobId', (req, res) => {
  const { jobId } = req.params;
  const data = loadResults(jobId);

  if (!data) {
    return res.status(404).json({ success: false, error: 'Results not found' });
  }

  res.json({ success: true, data });
});

// GET /api/scraper/jobs - List all scraping jobs
router.get('/jobs', (req, res) => {
  const active = getAllActiveJobs();
  const stored = listJobs();

  // Merge active and stored, prefer active status
  const activeIds = new Set(active.map(j => j.jobId));
  const allJobs = [
    ...active,
    ...stored.filter(j => !activeIds.has(j.jobId))
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ success: true, jobs: allJobs });
});

// DELETE /api/scraper/jobs/:jobId - Delete a job result
router.delete('/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, '..', '..', 'data', `${jobId}.json`);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return res.json({ success: true, message: 'Job deleted' });
  }
  res.status(404).json({ success: false, error: 'Job not found' });
});

module.exports = router;
