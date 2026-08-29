// POST /api/assign-batch  { date, jobSiteId, employeeIds:[...], startTime, bring? }
// Create one Daily Schedule row per worker for a project + day. Skips workers
// already on that project that day.

const { T, F, esc, atGetAll, atWriteChunked, configured, adminOk, readBody } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    if (!configured()) return res.status(500).json({ error: 'Server not configured.' });
    if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized.' });

    const b = readBody(req);
    const date = String(b.date || '').trim();
    const jobSiteId = String(b.jobSiteId || '').trim();
    const employeeIds = Array.isArray(b.employeeIds) ? b.employeeIds.filter(Boolean) : [];
    const startTime = String(b.startTime || '').trim();
    const bring = b.bring || '';
    const vehicleId = String(b.vehicleId || '').trim();
    const equipmentIds = Array.isArray(b.equipmentIds) ? b.equipmentIds.filter(Boolean) : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
    if (!jobSiteId) return res.status(400).json({ error: 'jobSiteId required.' });
    if (!employeeIds.length) return res.status(400).json({ error: 'Select at least one worker.' });

    const day = await atGetAll(T.schedule, { filterByFormula: `DATESTR({${F.sch.date}})='${esc(date)}'` });
    const already = new Set();
    day.forEach((r) => {
      if ((r.fields[F.sch.project] || []).includes(jobSiteId)) {
        (r.fields[F.sch.employees] || []).forEach((id) => already.add(id));
      }
    });
    const toAdd = employeeIds.filter((id) => !already.has(id));

    const records = toAdd.map((empId) => ({
      fields: {
        [F.sch.date]: date,
        [F.sch.employees]: [empId],
        [F.sch.project]: [jobSiteId],
        [F.sch.startTime]: startTime ? [startTime] : [],
        [F.sch.notes]: bring,
        [F.sch.status]: 'Pending',
        [F.sch.vehicle]: vehicleId ? [vehicleId] : [],
        [F.sch.equipment]: equipmentIds,
      },
    }));
    let created = [];
    if (records.length) created = await atWriteChunked('POST', T.schedule, records);
    return res.status(200).json({ ok: true, created: created.length, skipped: employeeIds.length - toAdd.length });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
