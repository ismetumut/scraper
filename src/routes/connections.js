const express = require('express');
const router = express.Router();

const { loadTargets, addTarget, removeTarget } = require('../utils/targets');
const { runCheck, getStoredReports } = require('../services/connections-tracker');
const { sendMail } = require('../utils/mailer');
const { todayString } = require('../utils/connections-store');

// Tracks an in-flight check so the UI can disable the button / show progress.
let runState = { running: false, startedAt: null, finishedAt: null, lastError: null };

// GET /api/connections/targets - list tracked people
router.get('/targets', (req, res) => {
  res.json({ success: true, targets: loadTargets() });
});

// POST /api/connections/targets - add a tracked person
router.post('/targets', (req, res) => {
  const { name, profileUrl } = req.body || {};

  if (!profileUrl || !profileUrl.includes('linkedin.com/in/')) {
    return res.status(400).json({
      success: false,
      error: 'Gecerli bir LinkedIn profil URL gerekli (linkedin.com/in/...).'
    });
  }

  const displayName = (name && name.trim()) || profileUrl;
  const { added, targets } = addTarget(displayName, profileUrl);

  if (!added) {
    return res.status(409).json({ success: false, error: 'Bu kisi zaten takip ediliyor.', targets });
  }
  res.json({ success: true, targets });
});

// DELETE /api/connections/targets/:slug - stop tracking a person
router.delete('/targets/:slug', (req, res) => {
  const { removed, targets } = removeTarget(req.params.slug);
  if (!removed) {
    return res.status(404).json({ success: false, error: 'Kisi bulunamadi.' });
  }
  res.json({ success: true, targets });
});

// GET /api/connections/results - stored diff report (no scraping)
router.get('/results', (req, res) => {
  res.json({ success: true, reports: getStoredReports(), runState });
});

// GET /api/connections/status - current run state
router.get('/status', (req, res) => {
  res.json({ success: true, runState });
});

// POST /api/connections/run - trigger a check now (runs in background)
router.post('/run', async (req, res) => {
  if (runState.running) {
    return res.status(409).json({ success: false, error: 'Kontrol zaten calisiyor.' });
  }

  const sendEmail = !!(req.body && req.body.email);

  runState = { running: true, startedAt: new Date().toISOString(), finishedAt: null, lastError: null };

  // Run in background; the UI polls /status and reloads /results when done.
  (async () => {
    try {
      const { date, reports } = await runCheck();

      if (sendEmail && process.env.NOTIFY_EMAIL) {
        const lines = reports.map(r => {
          if (r.error) return `${r.name}: HATA - ${r.error}`;
          if (!r.newConnections.length) return `${r.name}: yeni baglanti yok`;
          return `${r.name}: ${r.newConnections.length} yeni\n` +
            r.newConnections.map(c => `  - ${c.fullName}${c.headline ? ' - ' + c.headline : ''}`).join('\n');
        }).join('\n\n');
        await sendMail({
          to: process.env.NOTIFY_EMAIL,
          subject: `LinkedIn Baglanti Takip Raporu - ${date}`,
          text: `LinkedIn Baglanti Takip Raporu - ${date}\n\n${lines}`
        }).catch(err => console.error('Mail gonderilemedi:', err.message));
      }

      runState.running = false;
      runState.finishedAt = new Date().toISOString();
    } catch (err) {
      runState.running = false;
      runState.finishedAt = new Date().toISOString();
      runState.lastError = err.message;
      console.error('Connections check failed:', err.message);
    }
  })();

  res.json({ success: true, message: 'Kontrol baslatildi.', runState });
});

module.exports = router;
