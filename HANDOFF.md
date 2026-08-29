# Crew Dispatch — Project Handoff

A crew-dispatch web app for a construction company (Artisan Specialties, Waterloo IA).
Dad builds a daily schedule on a desktop **board**; each worker gets a **permanent link**
that always shows *today's* job (and tomorrow's, once it's afternoon) and lets them Confirm / Can't-Make-It. Built by Charlie
(CS student) as the first client project for an automation agency.

---

## 1. Where everything lives

- **Local code:** `~/Dad/crew-dispatch` (on Charlie's Mac). No git; deploys via Vercel CLI.
- **Deploy:** `cd ~/Dad/crew-dispatch && vercel --prod`  (env-var changes only apply to a NEW deploy)
- **Vercel project:** `crew-dispatch` (team: charlie-3920's projects). Live domain: **crew-dispatch-nine.vercel.app**
  - Worker page: `/job?t=<employeeToken>`   · Board: `/board`
- **Stack:** plain HTML/CSS/JS + Node serverless functions in `/api`. `cleanUrls` on. No build step.
- **Data:** Airtable. The browser never sees the Airtable key — only the `/api/*` functions talk to Airtable.

## 2. Vercel environment variables

- `AIRTABLE_TOKEN` — Airtable Personal Access Token (dad's). Scopes: data.records:read, data.records:write, schema.bases:read. Access = the Artisan base.
  - ⚠️ **Rotate this** — it was pasted into the old chat. Regenerate in Airtable, update Vercel, redeploy.
- `AIRTABLE_BASE_ID` = `appXU0CXVxT3d35VY`  (the live "Artisan Project Management" base)
- `ADMIN_KEY` = board password (Charlie set it). Gates the board + all write endpoints.
- `TIMEZONE` = `America/Chicago`  (decides what "today" means for the links)

## 3. Airtable bases

- **LIVE:** `appXU0CXVxT3d35VY` — "Artisan Project Management" (dad's real business base). This is what the app reads/writes now.
- `appROy3jYQFr2qASd` — "Crew Dispatch Practice" (early scaffolding; NOT used in prod).
- `appIsgEBchna7qxpf` — "Estimate Table" (separate n8n estimate-followup automation; unrelated).

### Live base — tables & how the app maps them
Table/field names are centralized in `api/_lib.js` (objects `T` and `F`). To retarget a base, edit those.

- **Employees** `tblMjppmifUSgzJ97` = the crew.
  - Existing: `Name`, `Status` (single-select **Current / Off / Past** — "Current" = active), `Phone`, `Email`, `Address`, `Hire Date`, `Birthday`, `Notes`, `Pay Rate`.
  - **Added by us:** `Token` (permanent worker-link UUID, backfilled for all 24), `Order` (roster drag order), `Category` (role label — Charlie fills in), `Rating` (old star field, now UNUSED).
  - ⚠️ Some `Name` cells have address/DOB text jammed in after a newline — the app trims to the first line for display.
- **Projects** `tbl5vFq1uE7AndTCg` = the job sites.
  - Used: `Project Name`, `Address`, `Status` (multi: Prestart/Active/Inactive/Completed), `Start Date`, `Duration (days)`, `Completion Date`, `Total Sq Ft`, `Superintendent` (link→Contacts) + `Superintendent Phone` (lookup), `Customers` (link→Company), `Contact` (link→Contacts).
  - **Added by us:** `Board Order`, `Board Half` (Top/Bottom), `Mileage`.
  - ⚠️ Lots of MONEY fields (contract, labor, profit, invoicing…). The app NEVER writes them and NEVER shows them to anyone.
- **Daily Schedule** `tblhEI5kHOnliY21G` = assignments (one row per worker per day, going forward).
  - Used: `Date`, `Project Name` (link→Projects), `Employees` (link→Employees), `Start Time` (multi: **6:00am / 7:00am / other**), `Notes` (reused as the "bring / on-site" note), `Equipment` (link→Equipment).
  - **Added by us:** `Status` (Pending/Confirmed/Declined), `Confirmed At`, `Vehicle` (link→Equipment), `Published At` (dateTime — stamped by the board's Publish button; recordkeeping only, texting is manual).
- **Equipment** `tblXfDWLq5i3fQ4IE` = holds BOTH vehicles and gear.
  - `Name`, `Notes`, **`Type` (added: Vehicle / Equipment)**. Trucks/van tagged Vehicle; scissor lift + added Scaffold/Ladder/Cart tagged Equipment.
- **Contacts** `tblcZiHM6AFnchnQC` (`Name`, `Cell Phone`) — resolves superintendent/contact names for the info panel.
- **Company** `tblnVxkiXjYCq8vzS` (`Name`) — resolves customer names.

## 4. How it works (data model)

- **Worker link is permanent and per-employee** (`/job?t=<Employees.Token>`). It shows that person's Daily Schedule rows for **today** (business tz), and **from 2pm onward it also shows tomorrow's assignment** if one exists (crews plan the night before; cutover hour = `CUTOVER_HOUR` in `api/assignment.js`). Text each worker once; they reopen the same link daily. New hires: board has a **"New-hire links"** button (or `/api/ensure-employee-tokens`).
- **Confirm/Decline** posts `{t, jobSiteId, date, action}` → sets Status + Confirmed At on the matching Daily Schedule row (no record IDs in any URL).
- **One row per worker per day** is the convention. Legacy rows with multiple employees share a single Status (fine going forward since the app creates single-worker rows).
- Board defaults to **Active** projects only (+ any with crew today); "all projects" toggle shows the rest. **Typing in the site search overrides the filter and searches everything**; every card shows a color-coded status pill (Active / Prestart / Inactive / Completed / No status) so search results are unambiguous.
- The logo (`logo.png`) is a black square with white shapes that bleed to its edges — never place it on white. Both pages show it raw with a royal-blue border ring.

## 5. Code files (`~/Dad/crew-dispatch`)

- `api/_lib.js` — **the schema map (`T`, `F`)** + Airtable REST helpers + active/name/start-time/today helpers. Edit here to retarget a base or rename a field.
- `api/assignment.js` — GET `/api/assignment?t=` → `days[]` (today always; tomorrow after the 2pm cutover if scheduled). Each job: site, address, start, bring, vehicle, equipment, coworkers, status. Legacy top-level `{date, jobs}` = today only.
- `api/respond.js` — POST confirm/decline.
- `api/board.js` — GET `/api/board?date=` → employees (incl. phone/email/address/status for the worker editor), jobSites (+info + mileage + half + order), assignments (expanded per worker, with vehicle/equipment), vehicles list, equipment list.
- `api/save-assignment.js` — create/update one row (date, employee, site, startTime, bring, vehicleId, equipmentIds).
- `api/assign-batch.js` — assign many workers to a site at once.
- `api/duplicate.js` — Duplicate Yesterday.
- `api/delete-assignment.js` — delete a row.
- `api/publish.js` — POST `{date}` → stamps `Published At` on that day's rows. Feeds the board's **Publish & text** modal: one row per assigned worker with an iOS `sms:` link (`sms:+1…&body=…`), copy-msg fallback, and a localStorage "mark sent" checklist (`cd_sent_<date>`). NO Twilio/SMS API by explicit decision — sending is manual. ⚠️ Employees.Phone currently contains ADDRESSES (duplicate of Address field), zero real numbers — `e164()` in board.html rejects them, so every row shows "no phone" until numbers are typed in via the roster ✎ editor.
- `api/reorder.js` — `{kind:'employees'|'projects', ids}` → roster Order / Board Order. ⚠️ **Vercel Hobby caps deployments at 12 functions** — that's why reorder is one endpoint and "New-hire links" minting lives inside save-employee (`{ensureTokens:true}`). Currently at 11; a 13th api file fails the deploy.
- `api/save-site.js` — update a Project's address / mileage / Board Half, **or create a new Project** (no id → create with name/address/mileage/status/half only; never touches money/links). Deleting projects stays in Airtable on purpose.
- `api/save-employee.js` — create/update a crew member from the board (name, role/Category, phone, email, address, Status). Create mints the permanent Token server-side; `{id, regenerateToken:true}` mints a NEW token (old link dies instantly — lost phone / bad-terms leaver). "Remove from crew" = Status→Past; this endpoint **never deletes records** and never writes Pay Rate.
- `board.html` — dad's dashboard (roster + site cards + all the features below).
- `job.html` — worker mobile page (royal-blue/charcoal skin, multi-day rendering).
- `logo.png` — Artisan logo, served locally (was hotlinked from Wix; source of truth if it ever changes = their site).
- `index.html`, `vercel.json` (cleanUrls), `package.json`, `.env.example`, `test/verify.cjs` (offline logic test — mocks the LIVE schema, 20 checks incl. the 2pm cutover).

## 6. Features currently on the board

Roster (left): search, drag-to-reorder (persists via Order), "Select" mode for multi-select + site highlighting, per-worker copy-link, Category tag, "unplaced" filter. **+ Add** button creates a worker (token minted immediately); hover **✎** on any row opens the worker editor (name/role/phone/email/address/status; "Remove from crew" = Status→Past, never deletes). The editor only sends CHANGED fields, so Name cells with junk after a newline aren't clobbered unless dad actually edits the name. "New-hire links" lives at the roster's foot (fallback — new workers created here already get links).
Toolbar: site search + **+ New site** (creates a Project: name/address/mileage/status only).
Sites render as **compact Excel-style ROWS** (dad's request — he schedules like a spreadsheet): one row per site = grip · status LED · fixed-width name (address+mileage in the tooltip) · status pill ONLY when not plain-Active · confirmed count · inline worker chips (dot, name, time, vehicle/equipment tags; link/⋯/✕ appear on hover) · right-side buttons **+ crew / info / ✎** (✎ = info modal opened straight in edit mode). Rows are grouped into an active shelf (top) and an **"Inactive" shelf** (bottom) split by a slim FIXED bar (everything scrolls as one sheet; the bar is NOT resizable — dad wanted fixed slots). Top rows get **▼** (move under the bar); Inactive rows get **▲** (back to END of active shelf). The toolbar **Edit** button (next to + New site) is a select-mode for JOBS: check the ones to keep on top; on Done every unchecked job goes under the bar (each change saved via save-site). Site-row dragging is a CUSTOM mouse drag (`startSiteDrag`), NOT HTML5 dnd: the row lifts as position:fixed, is **locked to the Y axis**, an insertion gap (`.drop-slot`) marks the landing slot (`positionSlot` at row midpoints, `autoScroll` near edges), and `dropSiteViaSlot` lands it. Worker-chip and roster-name drags are still HTML5 dnd. Double-clicking a row's empty space opens the crew picker. The site list has `padding-bottom` so the last rows clear the floating Summary button. Grip drag shows the whole row and opens an Excel-style **insertion gap** (`.drop-slot`) where the row would land; drop on a row on the other shelf adopts that shelf. Column widths are resizable like a spreadsheet: the roster panel (`--rosterw`/`cd_roster_w`, handle on its right edge) and the site-name column (`--namew`/`cd_name_w`, handle in the column header). Info/edit modal: name, address, mileage, start date, duration, sq ft, status toggles editable via save-site; superintendent/customer/contact read-only; NO money ever. **+ crew** picker is a SET-EDITOR: opens with current crew pre-checked; check = add, un-check = remove on save (legacy multi-employee shared rows are skipped with a toast — remove those via chip ✕). Start-time applies to newly added workers only.
Removing a worker from a job: ✕ on the chip, ⋯ → Remove, or **drag the chip back onto the roster** (roster shows a red dashed outline while dragging). There is NO needs-attention banner (was built, removed at Charlie's request) — declines surface only as red chip dots + header counts. `DRAGKIND` global tracks what's being dragged (dataTransfer isn't readable during dragover).
Worker chips: status dot, name, start time, vehicle tag, equipment tag, copy-link, ⋯ edit (start time / vehicle / equipment / bring / remove), ✕ remove. Drag a chip between sites to move; drag a roster name onto a site to assign.
Header: date nav (weekday shown under the date), live counts, "all projects" toggle, Duplicate Yesterday. Floating **Summary** button (bottom-right) → printable day read-out grouped by site. Note: the `.btn-ghost` white skin is scoped to `header` — ghost buttons elsewhere use the light style.
Look: Artisan logo in header (served locally as `/logo.png`), blue-charcoal + royal-blue skin, subtle motion (card fade-in on load/changes but NOT on the 20s poll; pending LEDs pulse; modal/toast transitions; respects reduce-motion). `job.html` matches the same skin.

## 7. Known caveats / open items

- **Rotate the Airtable token** (pasted in old chat).
- **Brand color = ROYAL BLUE** (#2563eb / #1d4ed8 on blue-charcoal #141a26) — Charlie's pick; the original logo is blue (the local `logo.png` copy is greyscale). Display font: Barlow Condensed; body: Inter. If dad supplies an exact brand hex, change `--accent/--accent2/--accent-lt/--blue` in both html files.
- **Multi-employee legacy rows** share one confirmation status.
- **Drag-drop is desktop-only** (fine — board is dad's laptop).
- Old **Rating/star** field still exists in Airtable (Employees). Code no longer references it — delete the field in the Airtable UI whenever.
- **Weekly summary automation** (miles/jobs recap via Airtable/n8n) = explicitly future, not built.
- Confirm Airtable plan/record limits are fine for daily assignment rows over time.

## 8. Likely next steps

- **A real dry-run with dad on an actual morning before full rollout** — the gate for everything else.
- Nail exact brand colors.
- (Later) weekly summary automation; materials-pipeline tab on the board.

## 9. Verify / test

- Offline logic test: `node test/verify.cjs` (no key needed; mocks the live schema, 20 checks incl. tomorrow-cutover both sides of 2pm).
- Syntax check all: `for f in api/*.js; do node --check "$f"; done`
- After any board.html/job.html edit, extract + check the script:
  `node -e "const fs=require('fs');const h=fs.readFileSync('board.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);fs.writeFileSync('/tmp/x.js',m[1]);" && node --check /tmp/x.js`
