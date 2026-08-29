// POST /api/save-site
//   update: { id, address?, half?, mileage? }
//   create: { name, address?, mileage?, status? }   (no id → new Project)
// Lets dad add a job site from the board instead of opening Airtable.
// Creates/writes ONLY name/address/mileage/status/board fields — never money,
// never links. Deleting projects stays in Airtable on purpose. Gated.
const { T, F, atWrite, configured, adminOk, readBody } = require('./_lib');

const ALL_STATUSES = ['Prestart', 'Active', 'Inactive', 'Completed'];
const NEW_STATUSES = ['Active', 'Prestart']; // sane choices for a brand-new site

const num = (v) => (v === '' || v === null || v === undefined) ? null : Number(v);

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
    if (!configured()) return res.status(500).json({ error: 'Server not configured.' });
    if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized.' });
    const b = readBody(req);
    const id = String(b.id || '').trim();

    const fields = {};
    if (b.address !== undefined) fields[F.proj.address] = b.address;
    if (b.half !== undefined) fields[F.proj.half] = b.half;
    if (b.mileage !== undefined) fields[F.proj.mileage] = num(b.mileage);
    if (b.notes !== undefined) fields[F.proj.notes] = b.notes;
    if (b.format !== undefined) fields[F.proj.format] = String(b.format || '');

    if (id) {
      // Board "Edit info": name / status / dates / size. Completion Date is a
      // formula (start + duration) so it recalculates on its own.
      // Links (superintendent/customer/contact) and ALL money fields stay
      // Airtable-only — this endpoint will not write them.
      if (b.name !== undefined) {
        const nm = String(b.name).trim();
        if (!nm) return res.status(400).json({ error: 'Name cannot be empty.' });
        fields[F.proj.name] = nm;
      }
      if (b.status !== undefined) {
        const arr = (Array.isArray(b.status) ? b.status : [b.status]).filter((x) => ALL_STATUSES.includes(x));
        fields[F.proj.status] = arr;
      }
      if (b.startDate !== undefined) fields[F.proj.startDate] = b.startDate || null;
      if (b.duration !== undefined) fields[F.proj.duration] = num(b.duration);
      if (b.sqft !== undefined) fields[F.proj.sqft] = num(b.sqft);
      const out = await atWrite('PATCH', T.projects, { records: [{ id, fields }], typecast: true });
      return res.status(200).json({ ok: true, record: out.records[0] });
    }

    // create
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Site name is required.' });
    fields[F.proj.name] = name;
    const status = NEW_STATUSES.includes(b.status) ? b.status : 'Active';
    fields[F.proj.status] = [status];       // multiple-select in Airtable
    fields[F.proj.half] = b.half || 'Top';  // new sites land on the active shelf
    const out = await atWrite('POST', T.projects, { records: [{ fields }], typecast: true });
    return res.status(200).json({ ok: true, created: true, record: out.records[0] });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
