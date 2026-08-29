// POST /api/duplicate  { fromDate, toDate }
// Copy every Daily Schedule row from fromDate into toDate: same project,
// same worker(s), same start time & notes; Status reset to Pending, Confirmed
// At cleared. Refuses if toDate already has rows.

const { T, F, esc, atGetAll, atWriteChunked, configured, adminOk, readBody } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    if (!configured()) return res.status(500).json({ error: 'Server not configured.' });
    if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized.' });

    const b = readBody(req);
    const fromDate = String(b.fromDate || '').trim();
    const toDate = String(b.toDate || '').trim();
    const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (!ok(fromDate) || !ok(toDate)) return res.status(400).json({ error: 'Dates must be YYYY-MM-DD.' });
    if (fromDate === toDate) return res.status(400).json({ error: 'Dates are the same.' });

    const existing = await atGetAll(T.schedule, { filterByFormula: `DATESTR({${F.sch.date}})='${esc(toDate)}'` });
    if (existing.length) return res.status(409).json({ error: `${toDate} already has ${existing.length} row(s). Clear them first.` });

    const source = await atGetAll(T.schedule, { filterByFormula: `DATESTR({${F.sch.date}})='${esc(fromDate)}'` });
    if (!source.length) return res.status(404).json({ error: `No schedule found on ${fromDate}.` });

    const records = source.map((r) => {
      const f = r.fields;
      const fields = { [F.sch.date]: toDate, [F.sch.status]: 'Pending' };
      if (f[F.sch.employees]) fields[F.sch.employees] = f[F.sch.employees];
      if (f[F.sch.project]) fields[F.sch.project] = f[F.sch.project];
      if (f[F.sch.startTime]) fields[F.sch.startTime] = f[F.sch.startTime];
      if (f[F.sch.notes]) fields[F.sch.notes] = f[F.sch.notes];
      return { fields };
    });
    const created = await atWriteChunked('POST', T.schedule, records);
    return res.status(200).json({ ok: true, created: created.length });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
