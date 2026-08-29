// POST /api/save-assignment  — create OR update one Daily Schedule row (one worker).
// Create: { date, employeeId, jobSiteId, startTime, bring? }
// Update: { id, date?, employeeId?, jobSiteId?, startTime?, bring? }

const { T, F, atWrite, configured, adminOk, readBody } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    if (!configured()) return res.status(500).json({ error: 'Server not configured.' });
    if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized.' });

    const b = readBody(req);
    const fields = {};
    if (b.date !== undefined) fields[F.sch.date] = b.date;
    if (b.employeeId) fields[F.sch.employees] = [b.employeeId];
    if (b.jobSiteId) fields[F.sch.project] = [b.jobSiteId];
    if (b.startTime !== undefined) fields[F.sch.startTime] = b.startTime ? [b.startTime] : [];
    if (b.bring !== undefined) fields[F.sch.notes] = b.bring;
    if (b.vehicleId !== undefined) fields[F.sch.vehicle] = b.vehicleId ? [b.vehicleId] : [];
    if (b.equipmentIds !== undefined) fields[F.sch.equipment] = Array.isArray(b.equipmentIds) ? b.equipmentIds : [];

    if (b.id) {
      const out = await atWrite('PATCH', T.schedule, { records: [{ id: b.id, fields }], typecast: true });
      return res.status(200).json({ ok: true, record: out.records[0] });
    }
    if (!b.date || !b.employeeId || !b.jobSiteId) return res.status(400).json({ error: 'date, employeeId and jobSiteId required.' });
    fields[F.sch.status] = 'Pending';
    const out = await atWrite('POST', T.schedule, { records: [{ fields }], typecast: true });
    return res.status(200).json({ ok: true, record: out.records[0] });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
