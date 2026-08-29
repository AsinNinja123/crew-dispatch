// POST /api/publish  { date: 'YYYY-MM-DD' }
// Stamps "Published At" (= now) on every Daily Schedule row for that date.
// Recordkeeping ONLY: it says "dad finished building this day and started
// texting links". The texting itself is manual (sms: links on the board's
// Publish list) — this write succeeds or fails independently of any text.
// No Twilio / no SMS API by design; see HANDOFF.md. Gated by ADMIN_KEY.
const { T, F, esc, atGetAll, atWriteChunked, configured, adminOk, readBody } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    if (!configured()) return res.status(500).json({ error: 'Server not configured.' });
    if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized.' });
    const b = readBody(req);
    const date = String(b.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Provide date as YYYY-MM-DD.' });

    const rows = await atGetAll(T.schedule, { filterByFormula: `DATESTR({${F.sch.date}})='${esc(date)}'` });
    if (!rows.length) return res.status(200).json({ ok: true, stamped: 0 });

    const now = new Date().toISOString();
    await atWriteChunked('PATCH', T.schedule,
      rows.map((r) => ({ id: r.id, fields: { [F.sch.publishedAt]: now } })));
    return res.status(200).json({ ok: true, stamped: rows.length, at: now });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
