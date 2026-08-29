// POST /api/save-employee
//   update: { id, name?, phone?, email?, address?, category?, status? }
//   create: { name, phone?, email?, address?, category? }  (no id)
// Lets dad manage the crew from the board instead of opening Airtable.
// Creating mints a permanent worker Token immediately (link works right away).
// "Remove" from the board = status:'Past' — this endpoint NEVER deletes an
// employee record (pay rate / hire date / HR notes live on it) and NEVER
// writes Pay Rate or any other field not listed above. Gated.
const crypto = require('crypto');
const { T, F, atWrite, configured, adminOk, readBody } = require('./_lib');

const STATUSES = ['Current', 'Off', 'Past'];

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    if (!configured()) return res.status(500).json({ error: 'Server not configured.' });
    if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized.' });
    const b = readBody(req);

    // { ensureTokens: true } — give a link token to every Employee missing
    // one (the board's "New-hire links" button). Existing tokens untouched.
    // Lives here because Vercel Hobby caps deployments at 12 functions.
    if (b.ensureTokens) {
      const { atGetAll, atWriteChunked } = require('./_lib');
      const emps = await atGetAll(T.employees);
      const updates = emps.filter((r) => !r.fields[F.emp.token])
        .map((r) => ({ id: r.id, fields: { [F.emp.token]: crypto.randomUUID() } }));
      if (updates.length) await atWriteChunked('PATCH', T.employees, updates);
      return res.status(200).json({ ok: true, created: updates.length });
    }

    const id = String(b.id || '').trim();

    const fields = {};
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) return res.status(400).json({ error: 'Name cannot be empty.' });
      fields[F.emp.name] = name;
    }
    if (b.phone !== undefined) fields[F.emp.phone] = String(b.phone).trim();
    if (b.email !== undefined) fields[F.emp.email] = String(b.email).trim();
    if (b.address !== undefined) fields[F.emp.address] = String(b.address).trim();
    if (b.category !== undefined) fields[F.emp.category] = String(b.category).trim();
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Status must be Current, Off or Past.' });
      fields[F.emp.status] = b.status;
    }

    if (id) {
      // Regenerate the permanent link (lost phone / worker left on bad terms).
      // The old link 404s immediately; dad must text the new one.
      if (b.regenerateToken) fields[F.emp.token] = crypto.randomUUID();
      const out = await atWrite('PATCH', T.employees, { records: [{ id, fields }], typecast: true });
      return res.status(200).json({ ok: true, record: out.records[0] });
    }

    // create
    if (!fields[F.emp.name]) return res.status(400).json({ error: 'Name is required for a new worker.' });
    if (!fields[F.emp.status]) fields[F.emp.status] = 'Current';
    fields[F.emp.token] = crypto.randomUUID();
    const out = await atWrite('POST', T.employees, { records: [{ fields }], typecast: true });
    return res.status(200).json({ ok: true, created: true, record: out.records[0] });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
