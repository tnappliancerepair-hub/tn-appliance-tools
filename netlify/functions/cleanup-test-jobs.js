// cleanup-test-jobs — find (dry-run) and delete TEST jobs, i.e. jobs whose
// `test_run_id` is non-empty (real warranty/HCP jobs always have it empty).
// Office-password gated. DEFAULT = dry run: returns the exact list + counts so
// you SEE the scope before anything is deleted. Pass confirm:true to delete.
//
// The jobs table is large, so it scans id-desc in pages within a ~20s budget and
// returns next_page/more for the caller to continue. confirm deletes each found
// test job + its TDR rows.
//
//   POST { password, confirm?:false, start_page?:1 }
'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const JOBS = 7, TDR = 12;
const PER_PAGE = 250;
const TIME_BUDGET_MS = 20000;

function H() {
  const t = process.env.XANO_METADATA_TOKEN;
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function j(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'invalid_json' }); }

  const password = String(b.password || b.pin || '');
  if (!password) return j(401, { ok: false, error: 'password_required' });
  try {
    const vr = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const vd = await vr.json();
    if (!vd || !vd.success) return j(401, { ok: false, error: 'wrong_password' });
  } catch (_) { return j(200, { ok: false, error: 'auth_unavailable' }); }
  if (!process.env.XANO_METADATA_TOKEN) return j(500, { ok: false, error: 'XANO_METADATA_TOKEN missing' });

  const confirm = b.confirm === true || b.confirm === 'true';
  let page = Math.max(1, Number(b.start_page || 1));
  const t0 = Date.now();

  const found = [];     // { id, test_run_id, name }
  const byRun = {};
  let scannedPages = 0;
  let scannedRows = 0;
  let more = false;

  while (Date.now() - t0 < TIME_BUDGET_MS) {
    let d;
    try {
      const r = await fetch(`${META}/table/${JOBS}/content?page=${page}&per_page=${PER_PAGE}&sort=id&order=desc`, { headers: H() });
      if (!r.ok) { return j(502, { ok: false, error: 'scan_failed', status: r.status, page }); }
      d = await r.json();
    } catch (e) { return j(200, { ok: false, error: 'scan_error: ' + (e.message || e), page }); }
    const items = (d && d.items) || [];
    if (!items.length) { more = false; break; }
    scannedPages++; scannedRows += items.length;
    for (const it of items) {
      const tr = String(it.test_run_id || '').trim();
      if (tr) {
        found.push({ id: it.id, test_run_id: tr, name: ((it.customer_first_name || '') + ' ' + (it.customer_last_name || '')).trim() });
        byRun[tr] = (byRun[tr] || 0) + 1;
      }
    }
    page++;
    // If we got a full page, there's likely more; stop at budget and let caller resume.
    if (items.length < PER_PAGE) { more = false; break; }
    more = true;
    await sleep(60); // gentle on Xano
  }

  // Dry run: report what we'd delete in this scan window.
  if (!confirm) {
    return j(200, {
      ok: true, dry_run: true, found: found.length, by_run_id: byRun,
      sample: found.slice(0, 25), scanned_pages: scannedPages, scanned_rows: scannedRows,
      next_page: page, more,
    });
  }

  // Confirm: delete each found test job + its TDR rows.
  let deleted = 0, tdrDeleted = 0; const errors = [];
  for (const f of found) {
    try {
      // delete TDRs for this job first
      const sr = await fetch(`${META}/table/${TDR}/content/search`, { method: 'POST', headers: H(), body: JSON.stringify({ search: { job_id: f.id }, per_page: 50, page: 1 }) });
      if (sr.ok) {
        const sd = await sr.json();
        for (const row of (sd.items || [])) {
          if (Number(row.job_id) === Number(f.id)) {
            await fetch(`${META}/table/${TDR}/content/${row.id}`, { method: 'DELETE', headers: H() });
            tdrDeleted++;
          }
        }
      }
      const dr = await fetch(`${META}/table/${JOBS}/content/${f.id}`, { method: 'DELETE', headers: H() });
      if (dr.ok) deleted++; else errors.push(f.id);
      await sleep(50);
    } catch (_) { errors.push(f.id); }
  }
  return j(200, { ok: true, deleted, tdr_deleted: tdrDeleted, errors: errors.slice(0, 25), by_run_id: byRun, next_page: page, more });
};
