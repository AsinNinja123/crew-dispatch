// POST /api/respond   body: { t: <employeeToken>, jobSiteId, date, action: 'confirm'|'decline' }
// Writes Status + Confirmed At on the worker's Daily Schedule row for that
// project + day. POST-only so link-preview bots can't auto-confirm.

const {
  T, F, esc, atGet, atGetAll, atWrite, configured, readBody,
} = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    if (!configured()) return res.status(500).json({ error: 'Server not configured.' });

    const b = readBody(req);
    const token = String(b.t || b.token || '').trim();
    const jobSiteId = String(b.jobSiteId || '').trim();
    const date = String(b.date || '').trim();
    const status = b.action === 'confirm' ? 'Confirmed' : b.action === 'decline' ? 'Declined' : null;
    if (!token || !jobSiteId || !date) return res.status(400).json({ error: 'Missing token, site or date.' });
    if (!status) return res.status(400).json({ error: 'Invalid action.' });

    // who is this token?
    const emp = await atGet(T.employees, { filterByFormula: `{${F.emp.token}}='${esc(token)}'`, maxRecords: 1 });
    if (!emp.records.length) return res.status(404).json({ error: 'This link is not valid.' });
    const empId = emp.records[0].id;

    // find their row(s) for this project + day
    const day = await atGetAll(T.schedule, { filterByFormula: `DATESTR({${F.sch.date}})='${esc(date)}'` });
    const rows = day.filter((r) =>
      (r.fields[F.sch.employees] || []).includes(empId) &&
      (r.fields[F.sch.project] || []).includes(jobSiteId));
    if (!rows.length) return res.status(404).json({ error: 'Assignment not found.' });

    await atWrite('PATCH', T.schedule, {
      records: rows.map((r) => ({ id: r.id, fields: { [F.sch.status]: status, [F.sch.confirmedAt]: new Date().toISOString() } })),
    });
    return res.status(200).json({ ok: true, status });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
