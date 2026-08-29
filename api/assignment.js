// GET /api/assignment?t=<employeeToken>
// Permanent per-worker link -> that worker's job(s), read from Daily Schedule.
// Returns days[] — always today, PLUS tomorrow once it's afternoon (>= CUTOVER_HOUR
// in the business tz) and tomorrow has assignments. Crews plan the night before:
// a worker opening the link at 8pm needs tomorrow's site, not the one he just left.
// Each job carries jobSiteId + its day's date so Confirm/Decline can target the
// exact schedule row without exposing record IDs in any URL.
// Legacy top-level {date, jobs} = today only (kept for anything that cached it).

const {
  T, F, esc, todayISO, hourInTz, addDaysISO, cleanName, readStartTime,
  atGet, atGetAll, configured,
} = require('./_lib');

const CUTOVER_HOUR = 14; // 2pm: from here on, tomorrow's schedule matters more

function timeKey(s) {
  const m = String(s || '').match(/(\d{1,2}):(\d{2})\s*([ap])?m?/i);
  if (!m) return 9999;
  let h = +m[1]; if (m[3]) { h = h % 12; if (/p/i.test(m[3])) h += 12; }
  return h * 60 + (+m[2]);
}

// Build this worker's job list from one day's schedule rows.
function jobsFor(empId, sched, projById, equipById, nameById) {
  const mine = sched.filter((r) => (r.fields[F.sch.employees] || []).includes(empId));
  return mine.map((r) => {
    const f = r.fields;
    const projId = (f[F.sch.project] || [])[0];
    const proj = projById[projId] || {};
    // coworkers = everyone else on this project that day, across all rows
    const mates = new Set();
    sched.forEach((row) => {
      if ((row.fields[F.sch.project] || [])[0] === projId) {
        (row.fields[F.sch.employees] || []).forEach((id) => { if (id !== empId) mates.add(id); });
      }
    });
    const coworkers = [...mates].map((id) => ({ name: nameById[id] || 'Unknown', status: 'Pending' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const vId = (f[F.sch.vehicle] || [])[0];
    return {
      jobSiteId: projId || '',
      site: proj[F.proj.name] || '',
      address: proj[F.proj.address] || '',
      siteNotes: '',
      startTime: readStartTime(f),
      bring: f[F.sch.notes] || '',
      status: f[F.sch.status] || 'Pending',
      vehicle: vId ? (equipById[vId] || {})[F.equip.name] || '' : '',
      equipment: (f[F.sch.equipment] || []).map((id) => (equipById[id] || {})[F.equip.name] || '').filter(Boolean),
      coworkers,
    };
  }).sort((a, b) => timeKey(a.startTime) - timeKey(b.startTime));
}

module.exports = async (req, res) => {
  try {
    if (!configured()) return res.status(500).json({ error: 'Server not configured.' });
    const token = String(req.query.t || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing link.' });

    const found = await atGet(T.employees, { filterByFormula: `{${F.emp.token}}='${esc(token)}'`, maxRecords: 1 });
    if (!found.records.length) return res.status(404).json({ error: 'This link is not valid.' });
    const emp = found.records[0];
    const empName = cleanName(emp.fields);
    const today = todayISO();
    const showTomorrow = hourInTz() >= CUTOVER_HOUR;
    const tomorrow = addDaysISO(today, 1);

    const [emps, projects, schedToday, schedTomorrow] = await Promise.all([
      atGetAll(T.employees),
      atGetAll(T.projects),
      atGetAll(T.schedule, { filterByFormula: `DATESTR({${F.sch.date}})='${esc(today)}'` }),
      showTomorrow
        ? atGetAll(T.schedule, { filterByFormula: `DATESTR({${F.sch.date}})='${esc(tomorrow)}'` })
        : Promise.resolve([]),
    ]);
    let equipment = [];
    try { equipment = await atGetAll(T.equipment); } catch (e) { /* optional */ }
    const nameById = {}; emps.forEach((r) => { nameById[r.id] = cleanName(r.fields); });
    const projById = {}; projects.forEach((r) => { projById[r.id] = r.fields; });
    const equipById = {}; equipment.forEach((r) => { equipById[r.id] = r.fields; });

    const todayJobs = jobsFor(emp.id, schedToday, projById, equipById, nameById);
    const days = [{ date: today, jobs: todayJobs }];
    if (showTomorrow) {
      const tomorrowJobs = jobsFor(emp.id, schedTomorrow, projById, equipById, nameById);
      if (tomorrowJobs.length) days.push({ date: tomorrow, jobs: tomorrowJobs });
    }

    return res.status(200).json({ name: empName, today, days, date: today, jobs: todayJobs });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
