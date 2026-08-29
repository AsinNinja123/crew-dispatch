// Local verification of the live-base logic. No network, no key.
// Mocks the "Artisan Project Management" schema (Daily Schedule / Projects /
// Employees / Equipment) and runs the real handlers against it.
// Covers: permanent-token lookup, per-day job building, time sort, coworkers,
// vehicle resolution, the 2pm tomorrow-cutover, respond writes, POST-only guard.
// Run: node test/verify.cjs

process.env.AIRTABLE_TOKEN = 'fake';
process.env.AIRTABLE_BASE_ID = 'appFAKE0000000000';

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log((c ? '  PASS ' : '  FAIL ') + n); };

// ---- timezone picking: the cutover depends on the CURRENT hour in cfg.timezone,
// so pick real zones where it is currently afternoon / morning. ----
function hourIn(tz) {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()), 10);
}
function zoneWithHour(min, max) {
  for (let o = -14; o <= 12; o++) { // Etc/GMT+X means UTC-X (sign inverted)
    const tz = o === 0 ? 'Etc/GMT' : (o > 0 ? `Etc/GMT+${o}` : `Etc/GMT${o}`);
    try { const h = hourIn(tz); if (h >= min && h <= max) return tz; } catch (e) { /* skip */ }
  }
  throw new Error('no zone found');
}
const TZ_AFTERNOON = zoneWithHour(14, 22); // >= 2pm, safely before midnight
const TZ_MORNING = zoneWithHour(1, 12);    // before 2pm, safely after midnight

function dayISO(tz, shift) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + shift));
  return x.toISOString().slice(0, 10);
}

// ---- fake Airtable over the LIVE schema ----
let SCHED = [], PATCHES = [];
const EMP = [
  { id: 'recRILEY', fields: { Name: 'Riley Shaw', Token: 'emp-riley', Status: 'Current', Phone: '319-555-0101' } },
  { id: 'recMORGAN', fields: { Name: 'Morgan Lee\n123 Fake St', Token: 'emp-morgan', Status: 'Current' } }, // junk after newline on purpose
  { id: 'recSAM', fields: { Name: 'Sam Off', Token: 'emp-sam', Status: 'Current' } },
];
const PROJECTS = [
  { id: 'recA', fields: { 'Project Name': 'Riverside', Address: '88 River Rd', Status: ['Active'] } },
  { id: 'recB', fields: { 'Project Name': 'Maplewood', Address: '300 Maple', Status: ['Active'] } },
];
const EQUIP = [
  { id: 'recVAN', fields: { Name: 'Van 1', Type: 'Vehicle' } },
  { id: 'recLIFT', fields: { Name: 'Scissor Lift', Type: 'Equipment' } },
];
function seedSched(TODAY, YESTERDAY, TOMORROW) {
  SCHED = [
    // Riley works TWO sites today; Morgan is with Riley at Riverside.
    { id: 'recJ1', fields: { Date: TODAY, Employees: ['recRILEY'], 'Project Name': ['recA'], 'Start Time': ['6:00am'], Notes: 'Drills', Status: 'Pending', Vehicle: ['recVAN'] } },
    { id: 'recJ2', fields: { Date: TODAY, Employees: ['recMORGAN'], 'Project Name': ['recA'], 'Start Time': ['6:00am'], Status: 'Confirmed' } },
    { id: 'recJ3', fields: { Date: TODAY, Employees: ['recRILEY'], 'Project Name': ['recB'], 'Start Time': ['7:00am'], Status: 'Pending' } },
    // Yesterday row — must be ignored.
    { id: 'recJ0', fields: { Date: YESTERDAY, Employees: ['recRILEY'], 'Project Name': ['recA'], Status: 'Confirmed' } },
    // Tomorrow row — must appear ONLY after the 2pm cutover.
    { id: 'recJ4', fields: { Date: TOMORROW, Employees: ['recRILEY'], 'Project Name': ['recB'], 'Start Time': ['7:00am'], Notes: 'Saw', Status: 'Pending' } },
  ];
}

global.fetch = async (input, opts = {}) => {
  const url = typeof input === 'string' ? new URL(input) : input;
  const table = decodeURIComponent(url.pathname).split('/').pop();
  const formula = url.searchParams.get('filterByFormula') || '';
  const method = (opts.method || 'GET').toUpperCase();
  const jr = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
  if (method === 'PATCH') { const b = JSON.parse(opts.body); PATCHES.push({ table, ...b }); return jr({ records: b.records.map((r) => ({ id: r.id, fields: r.fields })) }); }
  if (table === 'Employees') {
    const tk = formula.match(/\{Token\}='([^']*)'/);
    return jr({ records: tk ? EMP.filter((e) => e.fields.Token === tk[1]) : EMP });
  }
  if (table === 'Projects') return jr({ records: PROJECTS });
  if (table === 'Equipment') return jr({ records: EQUIP });
  if (table === 'Daily Schedule') {
    const dm = formula.match(/DATESTR\(\{Date\}\)='([^']*)'/);
    return jr({ records: dm ? SCHED.filter((a) => a.fields.Date === dm[1]) : SCHED });
  }
  return jr({ records: [] });
};

function makeRes() { return { _s: 0, _j: null, status(c) { this._s = c; return this; }, json(o) { this._j = o; return this; }, setHeader() {} }; }

// (Re)load the handlers under a given timezone — cfg is captured at require time.
function loadHandlers(tz) {
  process.env.TIMEZONE = tz;
  ['../api/_lib.js', '../api/assignment.js', '../api/respond.js'].forEach((p) => { delete require.cache[require.resolve(p)]; });
  return { assignment: require('../api/assignment.js'), respond: require('../api/respond.js') };
}

(async () => {
  // ================= AFTERNOON (>= 2pm): tomorrow must show =================
  let TODAY = dayISO(TZ_AFTERNOON, 0), YESTERDAY = dayISO(TZ_AFTERNOON, -1), TOMORROW = dayISO(TZ_AFTERNOON, 1);
  seedSched(TODAY, YESTERDAY, TOMORROW);
  let { assignment, respond } = loadHandlers(TZ_AFTERNOON);

  let res = makeRes(); await assignment({ query: { t: 'emp-riley' } }, res);
  let d = res._j;
  console.log('\n[assignment, afternoon tz ' + TZ_AFTERNOON + '] Riley:', JSON.stringify(d).slice(0, 300) + '…');
  check('200', res._s === 200);
  check('name = Riley Shaw', d.name === 'Riley Shaw');
  check('two days returned (today + tomorrow)', Array.isArray(d.days) && d.days.length === 2);
  check('day 1 is today with 2 jobs', d.days[0].date === TODAY && d.days[0].jobs.length === 2);
  check('today sorted by time (Riverside 6am first)', d.days[0].jobs[0].site === 'Riverside' && d.days[0].jobs[1].site === 'Maplewood');
  check('vehicle resolved (Van 1)', d.days[0].jobs[0].vehicle === 'Van 1');
  check('bring note carried', d.days[0].jobs[0].bring === 'Drills');
  check('coworker Morgan shown, name trimmed to line 1', d.days[0].jobs[0].coworkers.some((c) => c.name === 'Morgan Lee'));
  check('day 2 is tomorrow with the Maplewood job', d.days[1].date === TOMORROW && d.days[1].jobs.length === 1 && d.days[1].jobs[0].site === 'Maplewood');
  check('yesterday row ignored', !d.days.some((day) => day.date === YESTERDAY));
  check('legacy jobs field = today only', d.jobs.length === 2 && d.date === TODAY);

  res = makeRes(); await assignment({ query: { t: 'emp-sam' } }, res);
  check('Sam: day off today, no tomorrow section', res._s === 200 && res._j.days.length === 1 && res._j.days[0].jobs.length === 0);

  res = makeRes(); await assignment({ query: { t: 'nope' } }, res);
  check('bad token -> 404', res._s === 404);
  res = makeRes(); await assignment({ query: {} }, res);
  check('missing token -> 400', res._s === 400);

  // Decline TOMORROW's job via the permanent link (no record IDs anywhere).
  PATCHES = []; res = makeRes();
  await respond({ method: 'POST', body: { t: 'emp-riley', jobSiteId: 'recB', date: TOMORROW, action: 'decline' } }, res);
  check('respond 200', res._s === 200);
  check('declined the right row (tomorrow @ Maplewood)', PATCHES[0] && PATCHES[0].records[0].id === 'recJ4' && PATCHES[0].records[0].fields.Status === 'Declined');
  check('Confirmed At stamped', Boolean(PATCHES[0].records[0].fields['Confirmed At']));
  check('respond GET blocked (405)', (await (async () => { const r = makeRes(); await respond({ method: 'GET', query: {} }, r); return r._s; })()) === 405);

  // ================= MORNING (< 2pm): today only =================
  TODAY = dayISO(TZ_MORNING, 0); YESTERDAY = dayISO(TZ_MORNING, -1); TOMORROW = dayISO(TZ_MORNING, 1);
  seedSched(TODAY, YESTERDAY, TOMORROW);
  ({ assignment } = loadHandlers(TZ_MORNING));

  res = makeRes(); await assignment({ query: { t: 'emp-riley' } }, res);
  d = res._j;
  console.log('[assignment, morning tz ' + TZ_MORNING + '] Riley days:', d.days.map((x) => x.date).join(', '));
  check('before 2pm: only today, even though tomorrow rows exist', d.days.length === 1 && d.days[0].date === TODAY);
  check('before 2pm: today still has both jobs', d.days[0].jobs.length === 2);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
