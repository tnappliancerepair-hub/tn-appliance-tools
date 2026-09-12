// platform-tn-report-back — carry a technician report filed ON THE PLATFORM back into Xano.
//
// THE HOLE IT CLOSES: platform-tn-report-tee moves reports Xano -> platform. Nothing moved them
// back. TN's crew has started working in platform/tech-job.html, which writes straight into the
// Supabase job_tdr table - so measured 2026-09-10, THREE real reports (Lee's FFE error code,
// Jimmy's, an ice-maker diagnosis) existed only on the platform while Xano showed nothing.
// That is not cosmetic: servicepower-claims-build reads XANO, so a report that never gets back
// there is a warranty claim that cannot be filed. It is money, and it grows as the crew moves over.
//
// FILL-THE-BLANK ONLY, both directions now. A field already filled in Xano is left exactly as it
// is - Xano stays the system of record and the office may have typed something better there.
// Only a field Xano has NOTHING for gets the platform's value.
//
// NO SIDE EFFECTS. Writes through update_tdr_field_from_voice, which upserts the in-progress TDR
// by (job_id, technician_id) and deliberately emits NO TDR_SUBMITTED - so nothing auto-routes the
// job between folders, nothing texts a customer, nothing fires the warranty chain. A report
// landing back in Xano must look exactly like the tech typed it there.
//
//   GET ?secret=<admin>              live run (fills blanks in Xano)
//   GET ?secret=…&dryrun=1           show what WOULD be written, write nothing
//   GET ?secret=…&days=N             how far back to look at platform reports (default 14)
//   GET ?secret=…&max=N              cap jobs touched in one run (default 40)
// Kill: vault PLATFORM_REPORT_BACK_ENABLED=false
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const md = require('./_lib/xano/metadata-crud');

// Same guard the mirror and the forward tee use. VAPI_ADMIN_SECRET resolves from NEITHER the
// vault nor process.env on this site, so those two siblings authenticate purely off this
// constant - matching them here rather than inventing a third scheme that 401s.
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const TDR_TABLE = 12;

const j = (code, body) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body, null, 1),
});
const s = (v) => String(v == null ? '' : v).trim();
const blank = (v) => !s(v);

// platform job_tdr -> Xano TDR. Exact inverse of the forward tee's mapping, so a value that
// came FROM Xano and went back would land on the field it started on (it never does - the
// forward tee only fills platform blanks, so anything here was typed on the platform).
// `parts_needed` is special on the Xano side: writing it also stamps verified_part_number,
// which is the plain TEXT column the office board, Ann and vendor-chase all read.
// ONLY THE TECH'S OWN INPUT TRAVELS BACK. The first dry-run wanted to write 47 fields across 38
// jobs, and almost none of it was new - it was the forward tee's own DERIVED values trying to
// round-trip. Two traps, both caught before a single live write:
//   * `outcome` is NOT the tech's words. The forward tee CLASSIFIES Xano's repair_completed +
//     final_recommendation prose into fixed / return_needed / not_fixable. Writing that token back
//     into Xano would launder a machine inference into the system of record, on top of prose the
//     tech actually wrote. Dropped entirely - it can never carry information Xano lacks.
//   * `labor_hours` on the platform is read from Xano's **labor_time_hours** first. That is a
//     DIFFERENT column from Xano's `labor_hours`, and it is the one techs actually fill - so
//     checking `labor_hours` for blankness said "empty" on 30+ jobs whose hours Xano already had.
//     Both columns must be blank before we send hours back.
const MAP = [
  { xano: 'diagnosis',        from: (t) => s(t.root_cause) },
  { xano: 'failed_component', from: (t) => s(t.failed_component) },
  { xano: 'labor_hours',      from: (t) => (t.labor_hours == null || t.labor_hours === '' ? '' : String(t.labor_hours)) },
];
// The part number does NOT go through the voice endpoint. Its `parts_needed` branch feeds a
// JSON/list column and answered "Text filter requires an integer, float, string or boolean
// value" on the first live run - the documented parts_needed list-column footgun. What actually
// matters is `verified_part_number`, the plain TEXT column the office board, Ann and
// vendor-chase all read, so we write that directly with a read-modify-write (Xano's content PUT
// replaces the row) - the same thing set-tdr-field does, minus an HTTP hop through our own site.
const PART_FROM = (t) => s(t.part_number);
const PART_BLANK_IF = ['verified_part_number', 'oem_part_number'];
// Which Xano column(s) must ALL be blank before that field is considered missing there.
const XANO_COL = {
  diagnosis: ['diagnosis'],
  failed_component: ['failed_component'],
  labor_hours: ['labor_time_hours', 'labor_hours'],           // labor_time_hours is the real one
};

async function runBack(opts) {
  const q = opts || {};
  const enabled = String((await getSecretFresh('PLATFORM_REPORT_BACK_ENABLED')) ?? 'true');
  if (enabled === 'false') return { ok: true, skipped: 'disabled' };

  const dryrun = q.dryrun === '1';
  const days = Math.min(90, Math.max(1, Number(q.days) || 14));
  const max = Math.min(200, Math.max(1, Number(q.max) || 40));

  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || process.env.PLATFORM_SUPABASE_URL;
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || process.env.PLATFORM_SUPABASE_SERVICE_KEY;
  const token = (await getSecret('XANO_METADATA_TOKEN')) || process.env.XANO_METADATA_TOKEN;
  if (!url || !key) return { ok: false, error: 'no_supabase_config' };
  if (!token) return { ok: false, error: 'no_xano_token' };
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  // 1) platform reports touched recently, on jobs that exist in Xano
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const sel = 'job_id,failed_component,part_number,root_cause,outcome,labor_hours,updated_at,' +
              'job:job_id(xano_id,technician_id)';
  const r = await fetch(
    `${url}/rest/v1/job_tdr?company_id=eq.${TN_COMPANY}&updated_at=gte.${since}` +
    `&select=${encodeURIComponent(sel)}&order=updated_at.desc&limit=1000`,
    { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) },
  );
  if (!r.ok) return { ok: false, error: 'supabase_' + r.status, body: (await r.text()).slice(0, 200) };
  const rows = (await r.json()) || [];

  // platform technician uuid -> xano tech id, so the upsert lands on the right tech's report
  const techXano = new Map();
  try {
    const tr = await fetch(`${url}/rest/v1/technician?company_id=eq.${TN_COMPANY}&select=id,xano_tech_id`,
      { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10000) });
    ((await tr.json()) || []).forEach((t) => { if (t.xano_tech_id) techXano.set(t.id, Number(t.xano_tech_id)); });
  } catch (_) {}

  const cands = rows
    .filter((t) => t.job && Number(t.job.xano_id) > 0)
    .filter((t) => MAP.some((m) => m.from(t)))
    .slice(0, max);

  const out = { ok: true, dryrun, days, looked_at: rows.length, candidates: cands.length,
                filled: 0, jobs_touched: 0, already_full: 0, errors: [], sample: [] };

  for (const t of cands) {
    const xid = Number(t.job.xano_id);
    // 2) what does Xano already have for this job? Newest report wins, same as everywhere else.
    let cur = {};
    try {
      const xr = await fetch(`${META}/table/${TDR_TABLE}/content/search`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ search: { job_id: xid }, sort: { id: 'desc' }, per_page: 5, page: 1 }),
        signal: AbortSignal.timeout(12000),
      });
      if (xr.ok) cur = ((await xr.json()).items || [])[0] || {};
    } catch (e) {
      out.errors.push({ job: xid, at: 'read_xano', err: String((e && e.message) || e).slice(0, 60) });
      continue;   // never guess "it's blank" on a failed read - that is how you overwrite good data
    }

    const todo = MAP.filter((m) => m.from(t) && XANO_COL[m.xano].every((c) => blank(cur[c])));
    const needPart = !!PART_FROM(t) && PART_BLANK_IF.every((c) => blank(cur[c]));
    if (!todo.length && !needPart) { out.already_full++; continue; }

    const techId = techXano.get(t.job.technician_id) || 0;
    const fieldNames = todo.map((m) => m.xano).concat(needPart ? ['verified_part_number'] : []);
    if (out.sample.length < 8) out.sample.push({ job: xid, tech: techId || null, fields: fieldNames });
    if (dryrun) { out.filled += fieldNames.length; out.jobs_touched++; continue; }

    let wrote = 0;
    for (const m of todo) {
      try {
        const body = { job_id: xid, field: m.xano, value: m.from(t) };
        if (techId) body.technician_id = techId;
        const wr = await fetch(`${XANO}/update_tdr_field_from_voice`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
        });
        const wd = await wr.json().catch(() => null);
        if (wd && wd.success) wrote++;
        else out.errors.push({ job: xid, field: m.xano, err: String((wd && (wd.message || wd.error)) || wr.status).slice(0, 80) });
      } catch (e) {
        out.errors.push({ job: xid, field: m.xano, err: String((e && e.message) || e).slice(0, 60) });
      }
    }
    // part number last: the voice writes above may have just CREATED the TDR row, so re-read
    // the newest one for this job rather than trusting the id we read before those writes.
    const partVal = PART_FROM(t);
    if (partVal && PART_BLANK_IF.every((c) => blank(cur[c]))) {
      try {
        const rows = await md.search(TDR_TABLE, { job_id: xid });
        const row = (Array.isArray(rows) ? rows : []).sort((a, b) => Number(b.id) - Number(a.id))[0];
        if (row && blank(row.verified_part_number) && blank(row.oem_part_number)) {
          const merged = Object.assign({}, row, { verified_part_number: partVal });
          delete merged.id; delete merged.created_at;
          await md.update(TDR_TABLE, Number(row.id), merged);
          wrote++;
        }
      } catch (e) {
        out.errors.push({ job: xid, field: 'verified_part_number', err: String((e && e.message) || e).slice(0, 80) });
      }
    }
    if (wrote) { out.filled += wrote; out.jobs_touched++; }
  }

  if (out.errors.length > 12) out.errors = out.errors.slice(0, 12);
  return out;
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let scheduled = false;
  try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  const out = await runBack(q);
  return j(out.ok === false ? 200 : 200, out);
};

exports.runBack = runBack;
