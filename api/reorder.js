// POST /api/reorder  { kind: 'employees' | 'projects', ids: [orderedIds...] }
// Persists drag order: writes position index into Employees.Order or
// Projects."Board Order". (One endpoint for both — Vercel's Hobby plan caps
// a deployment at 12 serverless functions, so endpoints are consolidated.)
// Gated by ADMIN_KEY.
const { T, F, atWriteChunked, configured, adminOk, readBody } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    if (!configured()) return res.status(500).json({ error: 'Server not configured.' });
    if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized.' });
    const b = readBody(req);
    const ids = Array.isArray(b.ids) ? b.ids.filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'ids required.' });

    const kind = b.kind === 'projects' ? 'projects' : b.kind === 'employees' ? 'employees' : null;
    if (!kind) return res.status(400).json({ error: "kind must be 'employees' or 'projects'." });
    const table = kind === 'projects' ? T.projects : T.employees;
    const orderField = kind === 'projects' ? F.proj.order : F.emp.order;

    await atWriteChunked('PATCH', table, ids.map((id, i) => ({ id, fields: { [orderField]: i } })));
    return res.status(200).json({ ok: true, updated: ids.length });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
