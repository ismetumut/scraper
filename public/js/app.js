// ==================== PAGE NAVIGATION ====================

function showPage(pageName) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));

  const page = document.getElementById(`page-${pageName}`);
  const navLink = document.querySelector(`[data-page="${pageName}"]`);

  if (page) page.style.display = 'block';
  if (navLink) navLink.classList.add('active');

  if (pageName === 'dashboard' || pageName === 'my-lists') {
    loadJobs();
  }
}

// Nav click handlers
document.querySelectorAll('.sidebar-nav a').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    showPage(link.dataset.page);
  });
});

// ==================== TOAST ====================

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast-${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3500);
}

// ==================== API CALLS ====================

const API_BASE = '/api';

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
  return res.json();
}

// ==================== JOBS ====================

let pollingIntervals = {};

async function loadJobs() {
  try {
    const { jobs } = await apiGet('/scraper/jobs');
    updateStats(jobs || []);
    renderJobsTable(jobs || []);
    renderMyListsTable(jobs || []);

    // Start polling for active jobs
    (jobs || []).forEach(job => {
      if (['starting', 'navigating', 'scraping'].includes(job.status)) {
        startPolling(job.jobId);
      }
    });
  } catch (err) {
    console.error('Failed to load jobs:', err);
  }
}

function updateStats(jobs) {
  const total = jobs.length;
  const totalLeads = jobs.reduce((sum, j) => sum + (j.leadsFound || j.totalLeads || 0), 0);
  const active = jobs.filter(j => ['starting', 'navigating', 'scraping'].includes(j.status)).length;
  const completed = jobs.filter(j => j.status === 'completed').length;

  document.getElementById('stat-total-jobs').textContent = total;
  document.getElementById('stat-total-leads').textContent = totalLeads.toLocaleString();
  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-completed').textContent = completed;
}

function renderJobsTable(jobs) {
  const tbody = document.getElementById('jobs-table-body');

  if (!jobs.length) {
    tbody.innerHTML = `
      <tr><td colspan="6">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="64" height="64">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
          </svg>
          <h3>No scraping jobs yet</h3>
          <p>Start your first scrape to see results here</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = jobs.map(job => `
    <tr>
      <td>
        <strong>${escapeHtml(job.listName || 'Unknown')}</strong>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${job.jobId.slice(0, 8)}...</div>
      </td>
      <td>
        <span class="badge badge-${job.status}">
          <span class="badge-dot"></span>
          ${job.status}
        </span>
      </td>
      <td><strong>${(job.leadsFound || job.totalLeads || 0).toLocaleString()}</strong></td>
      <td>
        <div style="min-width:100px;">
          <span style="font-size:12px;color:var(--text-muted);">${job.progress || (job.status === 'completed' ? 100 : 0)}%</span>
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width:${job.progress || (job.status === 'completed' ? 100 : 0)}%"></div>
          </div>
        </div>
      </td>
      <td style="font-size:13px;color:var(--text-muted);">${formatDate(job.createdAt)}</td>
      <td>
        <div class="actions">
          ${job.status === 'completed' ? `
            <button class="btn btn-sm btn-success" onclick="viewLeads('${job.jobId}')">View</button>
            <button class="btn btn-sm btn-secondary" onclick="exportCSV('${job.jobId}')">CSV</button>
            <button class="btn btn-sm btn-secondary" onclick="exportJSON('${job.jobId}')">JSON</button>
          ` : ''}
          <button class="btn btn-sm btn-danger" onclick="deleteJob('${job.jobId}')">Del</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderMyListsTable(jobs) {
  const tbody = document.getElementById('my-lists-table-body');
  const completedJobs = jobs.filter(j => j.status === 'completed');

  if (!completedJobs.length) {
    tbody.innerHTML = `
      <tr><td colspan="5">
        <div class="empty-state">
          <h3>No completed scrapes</h3>
          <p>Completed scraping jobs will appear here</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = completedJobs.map(job => `
    <tr>
      <td><strong>${escapeHtml(job.listName || 'Unknown')}</strong></td>
      <td><span class="badge badge-completed"><span class="badge-dot"></span> completed</span></td>
      <td><strong>${(job.leadsFound || job.totalLeads || 0).toLocaleString()}</strong></td>
      <td style="font-size:13px;color:var(--text-muted);">${formatDate(job.completedAt || job.createdAt)}</td>
      <td>
        <div class="actions">
          <button class="btn btn-sm btn-success" onclick="viewLeads('${job.jobId}')">View</button>
          <button class="btn btn-sm btn-secondary" onclick="exportCSV('${job.jobId}')">CSV</button>
          <button class="btn btn-sm btn-secondary" onclick="exportJSON('${job.jobId}')">JSON</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ==================== SCRAPING ====================

async function startScrape() {
  const listUrl = document.getElementById('input-list-url').value.trim();
  const maxPages = parseInt(document.getElementById('input-max-pages').value) || 25;

  if (!listUrl) {
    showToast('Please enter a Sales Navigator list URL', 'error');
    return;
  }

  if (!listUrl.includes('linkedin.com/sales/')) {
    showToast('Invalid URL. Must be a Sales Navigator URL.', 'error');
    return;
  }

  const btn = document.getElementById('btn-start-scrape');
  btn.disabled = true;
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" class="spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Starting...';

  try {
    const result = await apiPost('/scraper/start', { listUrl, maxPages });

    if (result.success) {
      showToast('Scraping started! Tracking progress...');
      document.getElementById('input-list-url').value = '';
      startPolling(result.jobId);
      showPage('dashboard');
    } else {
      showToast(result.error || 'Failed to start scraping', 'error');
    }
  } catch (err) {
    showToast('Network error. Is the server running?', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="5,3 19,12 5,21 5,3"/></svg> Start Scraping';
  }
}

function startPolling(jobId) {
  if (pollingIntervals[jobId]) return;

  pollingIntervals[jobId] = setInterval(async () => {
    try {
      const { job } = await apiGet(`/scraper/status/${jobId}`);
      if (job && (job.status === 'completed' || job.status === 'failed')) {
        clearInterval(pollingIntervals[jobId]);
        delete pollingIntervals[jobId];

        if (job.status === 'completed') {
          showToast(`Scraping complete! ${job.leadsFound} leads extracted.`);
        } else {
          showToast('Scraping failed. Check the logs.', 'error');
        }
      }
      loadJobs();
    } catch (err) {
      // Ignore polling errors
    }
  }, 3000);
}

// ==================== SAVED LISTS ====================

async function fetchSavedLists() {
  const btn = document.getElementById('btn-fetch-lists');
  const container = document.getElementById('saved-lists-container');
  btn.disabled = true;
  btn.textContent = 'Fetching...';
  container.innerHTML = '<p style="color:var(--text-muted);font-size:14px;">Loading your saved lists...</p>';

  try {
    const result = await apiGet('/scraper/lists');

    if (result.success && result.lists.length > 0) {
      container.innerHTML = result.lists.map(list => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">
          <div>
            <strong>${escapeHtml(list.name)}</strong>
            <span style="color:var(--text-muted);font-size:13px;margin-left:8px;">${list.leadCount} leads</span>
          </div>
          <button class="btn btn-sm btn-primary" onclick="scrapeFromList('${escapeHtml(list.url)}')">Scrape</button>
        </div>
      `).join('');
    } else if (result.success) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:14px;">No saved lists found.</p>';
    } else {
      container.innerHTML = `<p style="color:var(--danger);font-size:14px;">${escapeHtml(result.error)}</p>`;
    }
  } catch (err) {
    container.innerHTML = '<p style="color:var(--danger);font-size:14px;">Failed to fetch lists. Check your session cookie.</p>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Fetch My Lists';
  }
}

function scrapeFromList(url) {
  document.getElementById('input-list-url').value = url;
  startScrape();
}

// ==================== VIEW LEADS ====================

async function viewLeads(jobId) {
  const modal = document.getElementById('leads-modal');
  const body = document.getElementById('modal-body');
  const footer = document.getElementById('modal-footer');
  const title = document.getElementById('modal-title');

  body.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px;">Loading leads...</p>';
  modal.classList.add('active');

  try {
    const result = await apiGet(`/scraper/results/${jobId}`);

    if (result.success && result.data.leads) {
      const leads = result.data.leads;
      title.textContent = `${result.data.listName || 'Leads'} (${leads.length})`;

      body.innerHTML = leads.map(lead => `
        <div class="lead-item">
          <div class="lead-avatar">${(lead.firstName || '?')[0].toUpperCase()}</div>
          <div class="lead-info">
            <div class="lead-name">
              ${lead.profileUrl ? `<a href="${escapeHtml(lead.profileUrl)}" target="_blank">${escapeHtml(lead.fullName)}</a>` : escapeHtml(lead.fullName)}
            </div>
            <div class="lead-title">${escapeHtml(lead.title)}</div>
            <div class="lead-company">${escapeHtml(lead.company)}${lead.location ? ' &middot; ' + escapeHtml(lead.location) : ''}</div>
          </div>
          <div class="lead-meta">
            ${lead.connectionDegree ? `<div>${escapeHtml(lead.connectionDegree)}</div>` : ''}
            ${lead.isPremium ? '<div style="color:var(--warning);">Premium</div>' : ''}
          </div>
        </div>
      `).join('');

      footer.innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        <button class="btn btn-success" onclick="exportCSV('${jobId}')">Export CSV</button>
        <button class="btn btn-primary" onclick="exportJSON('${jobId}')">Export JSON</button>
      `;
    } else {
      body.innerHTML = '<p style="text-align:center;color:var(--danger);padding:40px;">No leads found.</p>';
    }
  } catch (err) {
    body.innerHTML = '<p style="text-align:center;color:var(--danger);padding:40px;">Failed to load leads.</p>';
  }
}

function closeModal() {
  document.getElementById('leads-modal').classList.remove('active');
}

// Close modal on overlay click
document.getElementById('leads-modal').addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) closeModal();
});

// ==================== EXPORT ====================

function exportCSV(jobId) {
  window.open(`${API_BASE}/export/${jobId}/csv`, '_blank');
}

function exportJSON(jobId) {
  window.open(`${API_BASE}/export/${jobId}/json`, '_blank');
}

// ==================== DELETE ====================

async function deleteJob(jobId) {
  if (!confirm('Are you sure you want to delete this job?')) return;

  try {
    await apiDelete(`/scraper/jobs/${jobId}`);
    showToast('Job deleted');
    loadJobs();
  } catch (err) {
    showToast('Failed to delete job', 'error');
  }
}

// ==================== SETTINGS ====================

function saveSettings() {
  const cookie = document.getElementById('setting-cookie').value;
  const csrf = document.getElementById('setting-csrf').value;

  // Save to localStorage (for frontend reference)
  if (cookie) localStorage.setItem('sn_cookie', cookie);
  if (csrf) localStorage.setItem('sn_csrf', csrf);

  showToast('Settings saved! Note: For the scraper to use these, update your .env file on the server.');
}

// Load settings from localStorage
function loadSettings() {
  const cookie = localStorage.getItem('sn_cookie');
  const csrf = localStorage.getItem('sn_csrf');
  if (cookie) document.getElementById('setting-cookie').value = cookie;
  if (csrf) document.getElementById('setting-csrf').value = csrf;
}

// ==================== UTILITIES ====================

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ==================== INIT ====================

document.addEventListener('DOMContentLoaded', () => {
  loadJobs();
  loadSettings();
});

// CSS animation for spinner
const style = document.createElement('style');
style.textContent = `
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .spin { animation: spin 1s linear infinite; }
`;
document.head.appendChild(style);
