// api/_lib.js — shared helpers + the ONE place the schema mapping lives.
// Files starting with "_" are not routed by Vercel.
//
// This build targets the real "Artisan Project Management" base:
//   Employees   -> crew
//   Projects    -> job sites (read-only; money fields never written)
//   Daily Schedule -> assignments (one row per worker per day, going forward)
// To point at a different base, edit T and F below.

const AIRTABLE_API = 'https://api.airtable.com/v0';

const cfg = {
  token: process.env.AIRTABLE_TOKEN,
  baseId: process.env.AIRTABLE_BASE_ID,
  adminKey: process.env.ADMIN_KEY || '',
  timezone: process.env.TIMEZONE || 'America/Chicago',
};

// Table names (must match Airtable exactly).
const T = {
  employees: 'Employees',
  projects: 'Projects',
  schedule: 'Daily Schedule',
  company: 'Company',
  contacts: 'Contacts',
  equipment: 'Equipment',
};

// Field names, grouped by table.
const F = {
  emp:  { name: 'Name', phone: 'Phone', email: 'Email', address: 'Address', token: 'Token', order: 'Order', status: 'Status', category: 'Category' },
  empActiveValue: 'Current',                 // Employees.Status value that means "on the crew"
  proj: { name: 'Project Name', address: 'Address', status: 'Status', startDate: 'Start Date',
          completion: 'Completion Date', sqft: 'Total Sq Ft', superPhone: 'Superintendent Phone',
          superintendent: 'Superintendent', customers: 'Customers', contact: 'Contact',
          duration: 'Duration (days)', order: 'Board Order', mileage: 'Mileage', half: 'Board Half',
          notes: 'Board Notes', format: 'Board Format' },
  sch:  { date: 'Date', employees: 'Employees', project: 'Project Name', startTime: 'Start Time',
          notes: 'Notes', status: 'Status', confirmedAt: 'Confirmed At',
          vehicle: 'Vehicle', equipment: 'Equipment', publishedAt: 'Published At' },
  contact: { name: 'Name', cell: 'Cell Phone' },
  company: { name: 'Name' },
  equip: { name: 'Name', type: 'Type' },
};

const START_TIME_OPTIONS = ['6:00am', '7:00am', 'other'];

function esc(s) { return String(s).replace(/'/g, "\\'"); }

// Today's date (YYYY-MM-DD) in the business timezone.
function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
// Current hour (0-23) in the business timezone.
function hourInTz() {
  return parseInt(new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.timezone, hour: '2-digit', hour12: false,
  }).format(new Date()), 10);
}
// Shift a YYYY-MM-DD string by n days (no timezone math needed).
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

// ---- field readers (handle this base's quirks) ----
// Some Name cells have addresses / DOB jammed in on later lines — show only line 1.
function cleanName(f) { return String(f[F.emp.name] || '').split('\n')[0].trim(); }
function isActive(f) { return f[F.emp.status] === F.empActiveValue; }
// Start Time is a multiple-select; take the first chosen option.
function readStartTime(f) { const v = f[F.sch.startTime]; return (Array.isArray(v) ? v[0] : v) || ''; }

// ---- Airtable REST helpers ----
async function atGet(table, params = {}) {
  const url = new URL(`${AIRTABLE_API}/${cfg.baseId}/${encodeURIComponent(table)}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${cfg.token}` } });
  if (!r.ok) throw new Error(`Airtable GET ${table} ${r.status}: ${await r.text()}`);
  return r.json();
}
async function atGetAll(table, params = {}) {
  let records = [], offset;
  do {
    const page = await atGet(table, { ...params, pageSize: 100, offset });
    records = records.concat(page.records);
    offset = page.offset;
  } while (offset);
  return records;
}
async function atWrite(method, table, payload) {
  const r = await fetch(`${AIRTABLE_API}/${cfg.baseId}/${encodeURIComponent(table)}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Airtable ${method} ${table} ${r.status}: ${await r.text()}`);
  return r.json();
}
async function atWriteChunked(method, table, records) {
  const out = [];
  for (let i = 0; i < records.length; i += 10) {
    const res = await atWrite(method, table, { records: records.slice(i, i + 10), typecast: true });
    out.push(...res.records);
  }
  return out;
}
async function atDelete(table, id) {
  const r = await fetch(`${AIRTABLE_API}/${cfg.baseId}/${encodeURIComponent(table)}/${id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!r.ok) throw new Error(`Airtable DELETE ${table} ${r.status}: ${await r.text()}`);
  return r.json();
}

function configured() { return Boolean(cfg.token && cfg.baseId); }
function adminOk(req) {
  if (!cfg.adminKey) return true;
  const sent = req.headers['x-admin-key'] || (req.query && req.query.key) || '';
  return sent === cfg.adminKey;
}
function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b || {};
}

module.exports = {
  cfg, T, F, START_TIME_OPTIONS, esc, todayISO, hourInTz, addDaysISO,
  cleanName, isActive, readStartTime,
  atGet, atGetAll, atWrite, atWriteChunked, atDelete,
  configured, adminOk, readBody,
};
