// GET /api/board?date=YYYY-MM-DD  (&key=<ADMIN_KEY>)
// Everything dad's board needs for one day, read from the real base:
//   - employees (active = Status "Current"), with token/phone/order
//   - job sites = Projects, with an info panel (address, superintendent+phone,
//     customer, contact+phone, dates, status, sq ft) — NO money fields
//   - assignments = Daily Schedule rows for the date, expanded to one entry
//     per worker on each row.

const {
  T, F, esc, cleanName, isActive, readStartTime, atGetAll, configured, adminOk,
} = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (!configured()) return res.status(500).json({ error: 'Server not configured.' });
    if (!adminOk(req)) return res.status(401).json({ error: 'Unauthorized.' });
    const date = String(req.query.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Provide date as YYYY-MM-DD.' });

    // Core tables — required.
    const [emps, projects, sched] = await Promise.all([
      atGetAll(T.employees),
      atGetAll(T.projects),
      atGetAll(T.schedule, { filterByFormula: `DATESTR({${F.sch.date}})='${esc(date)}'` }),
    ]);
    // Contacts/Company only feed the project-info panel (customer/contact names).
    // If they're missing or inaccessible, the board still works — just without those names.
    let contacts = [], companies = [], equipment = [];
    try { contacts = await atGetAll(T.contacts); } catch (e) { /* optional */ }
    try { companies = await atGetAll(T.company); } catch (e) { /* optional */ }
    try { equipment = await atGetAll(T.equipment); } catch (e) { /* optional */ }

    const equipById = {}; equipment.forEach((r) => { equipById[r.id] = r.fields; });
    const vehicles = equipment.filter((r) => r.fields[F.equip.type] === 'Vehicle')
      .map((r) => ({ id: r.id, name: r.fields[F.equip.name] || '' })).sort((a, b) => a.name.localeCompare(b.name));
    const equipmentList = equipment.filter((r) => r.fields[F.equip.type] === 'Equipment')
      .map((r) => ({ id: r.id, name: r.fields[F.equip.name] || '' })).sort((a, b) => a.name.localeCompare(b.name));

    const empName = {}, empToken = {};
    emps.forEach((r) => { empName[r.id] = cleanName(r.fields); empToken[r.id] = r.fields[F.emp.token] || ''; });
    const contactById = {}; contacts.forEach((r) => { contactById[r.id] = r.fields; });
    const companyName = {}; companies.forEach((r) => { companyName[r.id] = r.fields[F.company.name] || ''; });

    const employees = emps.map((r) => ({
      id: r.id, name: cleanName(r.fields), active: isActive(r.fields),
      token: r.fields[F.emp.token] || '', category: r.fields[F.emp.category] || '',
      phone: r.fields[F.emp.phone] || '',   // needs-attention strip: call a decliner fast
      email: r.fields[F.emp.email] || '', address: r.fields[F.emp.address] || '',
      status: r.fields[F.emp.status] || '', // raw value for the worker-edit modal
      order: (r.fields[F.emp.order] === undefined ? 9999 : r.fields[F.emp.order]),
    })).sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));

    const jobSites = projects.map((r) => {
      const f = r.fields;
      const superId = (f[F.proj.superintendent] || [])[0];
      const contactId = (f[F.proj.contact] || [])[0];
      const custId = (f[F.proj.customers] || [])[0];
      const c = contactById[contactId] || {};
      return {
        id: r.id,
        name: f[F.proj.name] || '',
        address: f[F.proj.address] || '',
        order: (f[F.proj.order] === undefined ? 9999 : f[F.proj.order]),
        half: f[F.proj.half] || 'Top',
        mileage: (f[F.proj.mileage] === undefined ? '' : f[F.proj.mileage]),
        notes: f[F.proj.notes] || '',
        format: f[F.proj.format] || '',
        status: (f[F.proj.status] || []).join(', '),
        startDate: f[F.proj.startDate] || '',
        completion: f[F.proj.completion] || '',
        duration: f[F.proj.duration] || '',
        sqft: f[F.proj.sqft] || '',
        superName: superId ? (contactById[superId] || {})[F.contact.name] || '' : '',
        superPhone: (f[F.proj.superPhone] || [])[0] || '',
        customer: custId ? companyName[custId] || '' : '',
        contactName: c[F.contact.name] || '',
        contactPhone: c[F.contact.cell] || '',
      };
    }).sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));

    // Expand each schedule row to one entry per worker on it.
    const rows = [];
    sched.forEach((r) => {
      const f = r.fields;
      const projId = (f[F.sch.project] || [])[0] || '';
      const siteName = (projects.find((p) => p.id === projId) || { fields: {} }).fields[F.proj.name] || '';
      const vId = (f[F.sch.vehicle] || [])[0] || '';
      const eqIds = f[F.sch.equipment] || [];
      (f[F.sch.employees] || []).forEach((empId) => {
        rows.push({
          id: r.id, employeeId: empId, employeeName: empName[empId] || '',
          jobSiteId: projId, siteName,
          startTime: readStartTime(f), bring: f[F.sch.notes] || '',
          status: f[F.sch.status] || 'Pending', confirmedAt: f[F.sch.confirmedAt] || null,
          employeeToken: empToken[empId] || '',
          vehicleId: vId, vehicle: vId ? (equipById[vId] || {})[F.equip.name] || '' : '',
          equipmentIds: eqIds, equipment: eqIds.map((id) => (equipById[id] || {})[F.equip.name] || '').filter(Boolean),
          shared: (f[F.sch.employees] || []).length > 1,   // row has >1 worker
        });
      });
    });

    return res.status(200).json({ date, employees, jobSites, assignments: rows, vehicles, equipment: equipmentList });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
