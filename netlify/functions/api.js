'use strict';

/**
 * Lead List Manager API — Node port of the original FastAPI app (app/main.py),
 * implemented as a dependency-free Netlify Function.
 *
 * NOTE: Netlify Functions are serverless with an ephemeral filesystem, so the
 * original SQLite persistence cannot be preserved. State is kept in-memory and
 * resets on cold starts / across concurrent instances. For durable storage,
 * deploy to a stateful platform or back this with an external database.
 */

// Function is mounted at this base path by the redirect in netlify.toml.
const BASE_PATH = '/.netlify/functions/api';

const DEFAULT_MAPPING = {
  full_name: ['full_name', 'name', 'Name'],
  title: ['title', 'job_title', 'Title'],
  company: ['company', 'Company', 'account_name'],
  linkedin_url: ['linkedin_url', 'profile_url', 'LinkedIn URL'],
  email: ['email', 'Email'],
  country: ['country', 'Country'],
};

// In-memory store (ephemeral)
const db = {
  imports: [], // { id, filename, uploaded_at, headers, mapping }
  rawRows: [], // { import_id, row }
  leads: [], // { id, import_id, full_name, title, company, linkedin_url, email, country, created_at }
  exports: [], // { name, created_at, rows: [...] }
  nextImportId: 1,
  nextLeadId: 1,
};

function nowIso() {
  return new Date().toISOString();
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function notFound(detail = 'Not Found') {
  return json(404, { detail });
}

/**
 * Minimal RFC-4180-ish CSV parser. Returns { headers, rows } where rows are
 * objects keyed by header name.
 */
function parseCsv(text) {
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\r') {
      // ignore; handled by \n
    } else if (char === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }
  // Flush trailing field/record (no trailing newline)
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0].map((h) => String(h).trim());
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    // Skip fully empty trailing lines
    if (cells.length === 1 && cells[0] === '') continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cells[idx] !== undefined ? cells[idx] : '';
    });
    rows.push(obj);
  }
  return { headers, rows };
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function normalizeField(row, key) {
  if (!key) return '';
  const value = row[key];
  return value ? String(value).trim() : '';
}

function buildEffectiveMapping(headers, mapping) {
  const userMapping = mapping || {};
  const effective = {};
  for (const [canonical, aliases] of Object.entries(DEFAULT_MAPPING)) {
    const chosen = userMapping[canonical];
    if (chosen && headers.includes(chosen)) {
      effective[canonical] = chosen;
      continue;
    }
    const matched = aliases.find((a) => headers.includes(a)) || '';
    effective[canonical] = matched;
  }
  return effective;
}

function getImport(id) {
  return db.imports.find((imp) => imp.id === id) || null;
}

function importDetails(imp) {
  const effectiveMapping = buildEffectiveMapping(imp.headers, imp.mapping);
  return {
    import_id: imp.id,
    filename: imp.filename,
    uploaded_at: imp.uploaded_at,
    detected_headers: imp.headers,
    effective_mapping: effectiveMapping,
  };
}

/**
 * Decodes the request body, handling base64-encoded payloads from Netlify.
 */
function decodeBody(event) {
  if (!event.body) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf-8');
  }
  return event.body;
}

/**
 * Extracts the file content from a multipart/form-data body. Returns
 * { filename, content } or null if no file part is found.
 */
function parseMultipartFile(rawBody, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) return null;
  const boundary = match[1] || match[2];
  const delimiter = `--${boundary}`;

  const parts = rawBody.split(delimiter);
  for (const part of parts) {
    if (!/filename=/i.test(part)) continue;
    const fnMatch = /filename="([^"]*)"/i.exec(part);
    const filename = fnMatch ? fnMatch[1] : 'upload.csv';

    // Body starts after the blank line separating headers from content.
    const sep = part.indexOf('\r\n\r\n');
    if (sep === -1) continue;
    let content = part.slice(sep + 4);
    // Strip the trailing CRLF before the next delimiter.
    content = content.replace(/\r\n$/, '');
    return { filename, content };
  }
  return null;
}

// ---- Route handlers --------------------------------------------------------

function handleRoot() {
  return json(200, {
    service: 'lead-list-manager',
    status: 'ok',
    endpoints: [
      'GET /health',
      'POST /imports',
      'GET /imports/{import_id}',
      'POST /imports/{import_id}/map',
      'POST /imports/{import_id}/process',
      'GET /leads',
      'POST /exports',
      'GET /exports/latest',
    ],
  });
}

function handleHealth() {
  return json(200, { status: 'ok', service: 'lead-list-manager' });
}

function handleCreateImport(event) {
  const contentType =
    event.headers['content-type'] || event.headers['Content-Type'] || '';
  const rawBody = decodeBody(event);

  const file = parseMultipartFile(rawBody, contentType);
  if (!file) {
    return json(400, { detail: 'A CSV file upload is required (field "file")' });
  }
  if (!file.filename.toLowerCase().endsWith('.csv')) {
    return json(400, { detail: 'Only CSV files are supported' });
  }

  const { headers, rows } = parseCsv(file.content);
  if (headers.length === 0) {
    return json(400, { detail: 'CSV file must contain header row' });
  }

  const imp = {
    id: db.nextImportId++,
    filename: file.filename,
    uploaded_at: nowIso(),
    headers,
    mapping: null,
  };
  db.imports.push(imp);
  rows.forEach((row) => db.rawRows.push({ import_id: imp.id, row }));

  return json(200, {
    import_id: imp.id,
    filename: imp.filename,
    rows_received: rows.length,
  });
}

function handleGetImport(id) {
  const imp = getImport(id);
  if (!imp) return notFound('Import not found');
  return json(200, importDetails(imp));
}

function handleSetMapping(id, event) {
  const imp = getImport(id);
  if (!imp) return notFound('Import not found');

  let body;
  try {
    body = JSON.parse(decodeBody(event) || '{}');
  } catch {
    return json(400, { detail: 'Invalid JSON body' });
  }
  const mapping = (body && body.mapping) || {};

  for (const [canonical, header] of Object.entries(mapping)) {
    if (!(canonical in DEFAULT_MAPPING)) {
      return json(400, { detail: `Unknown canonical field: ${canonical}` });
    }
    if (header && !imp.headers.includes(header)) {
      return json(400, { detail: `Header not found in file: ${header}` });
    }
  }

  imp.mapping = mapping;
  return json(200, importDetails(imp));
}

function handleProcessImport(id) {
  const imp = getImport(id);
  if (!imp) return notFound('Import not found');

  const effectiveMapping = buildEffectiveMapping(imp.headers, imp.mapping);
  const rawRows = db.rawRows.filter((r) => r.import_id === id);

  let inserted = 0;
  let deduped = 0;

  for (const { row } of rawRows) {
    const lead = {
      full_name: normalizeField(row, effectiveMapping.full_name) || null,
      title: normalizeField(row, effectiveMapping.title) || null,
      company: normalizeField(row, effectiveMapping.company) || null,
      linkedin_url: normalizeField(row, effectiveMapping.linkedin_url) || null,
      email: normalizeField(row, effectiveMapping.email) || null,
      country: normalizeField(row, effectiveMapping.country) || null,
    };

    // Mirror the UNIQUE(linkedin_url) / UNIQUE(email) constraints.
    const dup = db.leads.some(
      (l) =>
        (lead.linkedin_url && l.linkedin_url === lead.linkedin_url) ||
        (lead.email && l.email === lead.email)
    );
    if (dup) {
      deduped++;
      continue;
    }

    db.leads.push({
      id: db.nextLeadId++,
      import_id: id,
      ...lead,
      created_at: nowIso(),
    });
    inserted++;
  }

  return json(200, {
    import_id: id,
    rows_inserted: inserted,
    rows_deduped: deduped,
  });
}

function handleListLeads(query) {
  const country = query.country;
  const company = query.company;
  const titleKeyword = query.title_keyword;

  let results = db.leads;
  if (country) results = results.filter((l) => l.country === country);
  if (company) {
    const needle = company.toLowerCase();
    results = results.filter(
      (l) => l.company && l.company.toLowerCase().includes(needle)
    );
  }
  if (titleKeyword) {
    const needle = titleKeyword.toLowerCase();
    results = results.filter(
      (l) => l.title && l.title.toLowerCase().includes(needle)
    );
  }

  return json(
    200,
    results.map((l) => ({
      id: l.id,
      full_name: l.full_name,
      title: l.title,
      company: l.company,
      linkedin_url: l.linkedin_url,
      email: l.email,
      country: l.country,
      created_at: l.created_at,
    }))
  );
}

function handleCreateExport() {
  const cols = ['full_name', 'title', 'company', 'linkedin_url', 'email', 'country'];
  const rows = db.leads.map((l) => cols.map((c) => l[c]));

  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '')
    .replace('T', '_');
  const name = `leads_${ts}.csv`;

  db.exports.push({ name, created_at: nowIso(), columns: cols, rows });

  return json(200, {
    export_path: `exports/${name}`,
    rows_exported: rows.length,
  });
}

function handleLatestExport() {
  if (db.exports.length === 0) {
    return notFound('No exports found');
  }
  const latest = db.exports[db.exports.length - 1];
  const lines = [latest.columns.join(',')];
  for (const row of latest.rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  const csv = lines.join('\n');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${latest.name}"`,
    },
    body: csv,
  };
}

// ---- Dispatcher ------------------------------------------------------------

exports.handler = async (event) => {
  // Normalize the path: strip the function mount prefix.
  let path = event.path || '/';
  if (path.startsWith(BASE_PATH)) {
    path = path.slice(BASE_PATH.length);
  }
  if (path === '') path = '/';
  path = path.replace(/\/+$/, '') || '/';

  const method = (event.httpMethod || 'GET').toUpperCase();
  const query = event.queryStringParameters || {};

  try {
    if (path === '/' && method === 'GET') return handleRoot();
    if (path === '/health' && method === 'GET') return handleHealth();

    if (path === '/imports' && method === 'POST') return handleCreateImport(event);
    if (path === '/leads' && method === 'GET') return handleListLeads(query);
    if (path === '/exports' && method === 'POST') return handleCreateExport();
    if (path === '/exports/latest' && method === 'GET') return handleLatestExport();

    // /imports/{id}, /imports/{id}/map, /imports/{id}/process
    const impMatch = /^\/imports\/(\d+)(\/map|\/process)?$/.exec(path);
    if (impMatch) {
      const id = parseInt(impMatch[1], 10);
      const sub = impMatch[2];
      if (!sub && method === 'GET') return handleGetImport(id);
      if (sub === '/map' && method === 'POST') return handleSetMapping(id, event);
      if (sub === '/process' && method === 'POST') return handleProcessImport(id);
    }

    return notFound();
  } catch (err) {
    return json(500, { detail: `Internal error: ${err.message}` });
  }
};
