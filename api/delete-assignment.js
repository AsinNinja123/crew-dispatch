// POST /api/delete-assignment  { id }  — remove one Daily Schedule row. Gated.
const { T, atDelete, configured, adminOk, readBody } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    if (!configured()) return res.status(500).json({ error: 'Server not configured.' });
    if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized.' });
    const id = String(readBody(req).id || '').trim();
    if (!id) return res.status(400).json({ error: 'Missing id.' });
    await atDelete(T.schedule, id);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
