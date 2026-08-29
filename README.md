# Crew Dispatch — Developer Guide

How this app works and how to change it yourself. (Business/handoff context
lives in `HANDOFF.md`; this file is about the code.)

## The big picture

There is no framework and no build step. Three layers:

```
Browser (board.html / job.html — plain HTML+CSS+JS)
   │  fetch('/api/...')            ← the ONLY way pages get or change data
   ▼
Vercel serverless functions (/api/*.js — plain Node)
   │  Airtable REST API (with the secret token from env vars)
   ▼
Airtable base "Artisan Project Management"   ← the single source of truth
```

Rules that keep this safe:

1. The browser NEVER talks to Airtable and never sees the Airtable key.
   Only `/api` functions do, using `AIRTABLE_TOKEN` from Vercel env vars.
2. `/api` functions only read/write the exact fields listed in `_lib.js`.
   Money fields on Projects are never read, written, or sent to any page.
3. Nothing ever hard-deletes an Employee or Project. "Remove" = a status
   change. Deleting stays in Airtable on purpose.
4. Every write endpoint (and the board itself) is gated by `ADMIN_KEY`.
   The worker endpoints (`assignment`, `respond`) are gated by the per-worker
   token instead — a worker can only see and answer their own jobs.

## File map

### The two pages

- `board.html` — dad's dashboard. One file: CSS up top, HTML in the middle,
  one `<script>` at the bottom. The script has a "HOW THIS PAGE WORKS"
  comment block at the top — start there. Core loop: `refresh()` downloads
  the day into `STATE`, `render()` redraws everything from `STATE`.
- `job.html` — the worker's phone page. Much smaller, same idea:
  `load()` → `render()`. Commented at the top of its script.

### The API (one file = one URL)

`/api/foo.js` automatically becomes `https://.../api/foo` on Vercel.

- `_lib.js` — **the most important file.** The `T` (tables) and `F` (fields)
  objects map every Airtable table/field name the app uses. Rename a field
  in Airtable → fix it HERE, nowhere else. Also: Airtable REST helpers
  (`atGet`, `atGetAll`, `atWrite`, `atDelete`), `todayISO()`/`hourInTz()`
  (timezone-aware "today"), `adminOk()` (password check). Files starting
  with `_` are not routed as URLs.
- `assignment.js` — GET, worker's jobs. Returns `days[]`: today, plus
  tomorrow after 2pm (`CUTOVER_HOUR` constant at the top — change it there).
- `respond.js` — POST, worker's Confirm/Decline. Finds the schedule row by
  token + site + date, writes `Status` + `Confirmed At`.
- `board.js` — GET, everything the board needs for one date in one response.
- `save-assignment.js` — POST, create/update one schedule row (start time,
  bring note, vehicle, equipment, or move to another site).
- `assign-batch.js` — POST, put several workers on a site at once.
- `delete-assignment.js` — POST, remove a schedule row (the ✕ / drag-to-roster).
- `duplicate.js` — POST, copy all of yesterday's rows to today, reset to Pending.
- `save-employee.js` — POST, add/edit a worker. No `id` = create (also mints
  the permanent link token). `{regenerateToken:true}` = new link, old one dies.
- `save-site.js` — POST, edit a project's safe fields, or create a new project.
- `reorder.js` — POST `{kind:'employees'|'projects', ids}`, save drag order.
- `publish.js` — POST `{date}`, stamp Published At (feeds the Publish & text modal).

Note: Vercel's Hobby plan allows at most 12 functions per deployment, which is
why some endpoints are consolidated (reorder handles both kinds; the
"New-hire links" token-minting lives inside save-employee as
`{ensureTokens:true}`). If you add a 13th file the deploy FAILS — merge into
an existing endpoint instead.

### Everything else

- `logo.png` — served at `/logo.png`. Black square + white shapes: never put
  it on a white background (it has a blue ring in CSS instead).
- `index.html` — the bare landing page at `/`.
- `vercel.json` — `cleanUrls: true` is why `/board` works without `.html`.
- `test/verify.cjs` — offline test: fakes Airtable, runs the real
  `assignment.js`/`respond.js` handlers, 20 checks. No key needed.
- `.env.example` — documents the env vars; real values live in Vercel.

## How data flows (one concrete example)

Dad drags "Mike" onto the "Riverside" card:

1. `board.html` drop handler reads the drag payload `emp:<mikeId>` and calls
   `assignOne()` → `postAssign()` → `fetch('/api/assign-batch', {...})`.
2. `assign-batch.js` checks `adminOk()`, then creates a Daily Schedule row in
   Airtable: Date + Employees=[Mike] + Project=[Riverside], Status "Pending".
3. The page calls `refresh()`, re-downloads the day, re-renders. Mike's chip
   appears with a grey (pending) dot.
4. Mike opens his permanent link that evening; `assignment.js` finds the row;
   he taps Confirm; `respond.js` writes Status "Confirmed".
5. Within 20 seconds the board's poll picks it up: dot turns green.

## Recipes for common edits

**Change a color / the brand blue** — both pages define CSS variables at the
top of their `<style>`: `--accent`, `--accent2`, `--accent-lt`, `--blue`.
Change them in BOTH `board.html` and `job.html`.

**Change the 2pm tomorrow-cutover** — `CUTOVER_HOUR` in `api/assignment.js`.

**Airtable field renamed** — update the string in `T`/`F` in `api/_lib.js`.

**Show a new Airtable field on the board** (example: Projects "Gate Code"):
1. `_lib.js`: add `gateCode: 'Gate Code'` to `F.proj`.
2. `board.js`: add `gateCode: f[F.proj.gateCode] || ''` to the jobSites map.
3. `board.html`: use `s.gateCode` in `siteCardHtml()` or the info modal rows.
4. Test, deploy. (Same pattern for Employees/Daily Schedule fields.)

**Add a new endpoint** — copy the shape of `save-site.js`: check method,
`configured()`, `adminOk()`, read the body, build a `fields` object with only
the F-mapped fields you intend to write, `atWrite(...)`, return JSON.

## Test & deploy

```bash
node test/verify.cjs                              # offline logic test (20 checks)
for f in api/*.js; do node --check "$f"; done     # syntax-check the API
vercel --prod                                     # deploy (from this folder)
```

After editing `board.html`/`job.html`, extract + syntax-check the script:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('board.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/);fs.writeFileSync('/tmp/x.js',m[1]);" && node --check /tmp/x.js
```

Remember: env-var changes in Vercel only take effect on the NEXT deploy.
