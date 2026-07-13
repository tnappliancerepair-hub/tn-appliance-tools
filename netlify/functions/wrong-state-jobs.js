// wrong-state-jobs — find (and optionally fix) jobs showing the wrong STATE.
// TN Appliance only works TN + LA, so any job/customer whose state isn't TN/LA is
// a bad parse (Teddy 2026-07-13: "a few California and New York mistakes"). We
// infer the CORRECT state from the zip (37/38 = TN, 70/71 = LA) and, on ?fix=1,
// correct the job's service_state AND the customer's state — but only when the zip
// clearly maps to TN/LA, so we never guess.
//
//   GET  /wrong-state-jobs                 -> { ok, count, jobs:[...] }  (dry run)
//   POST /wrong-state-jobs {fix:true, secret}  -> corrects them, returns what changed
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
const OK = new Set(['TN', 'LA', '']);
const up = (s) => String(s == null ? '' : s).trim().toUpperCase();

// Infer state from a US zip: TN = 370xx–385xx, LA = 700xx–714xx. Else null (don't guess).
function stateFromZip(zip) {
  const z = String(zip || '').replace(/\D/g, '').slice(0, 5);
  if (z.length < 3) return null;
  const p = parseInt(z.slice(0, 3), 10);
  if (p >= 370 && p <= 385) return 'TN';
  if (p >= 700 && p <= 714) return 'LA';
  return null;
}

async function scanJobs() {
  let rows = [];
  for (let p = 1; p <= 16; p++) {
    const page = await crud.searchPageN(crud.TABLES.jobs, {}, { id: 'desc' }, 100, p).catch(() => []);
    if (!page.length) break;
    rows = rows.concat(page);
    if (page.length < 100) break;
  }
  return rows;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const doFix = event.httpMethod === 'POST';
  if (doFix) {
    let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
    const secret = String(b.secret || '');
    if (secret !== (process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5')) return j(403, { ok: false, error: 'forbidden' });
  }

  let rows;
  try { rows = await scanJobs(); } catch (e) { return j(500, { ok: false, error: 'scan_failed', detail: String(e && e.message || e) }); }

  const out = [];
  for (const r of rows) {
    const js = up(r.service_state);
    if (OK.has(js)) continue;                       // job state is fine (TN/LA/blank)
    const inferred = stateFromZip(r.service_zip);
    out.push({
      job_id: r.id,
      customer_id: r.customer_id || null,
      customer: `${(r.customer_first || '').trim()} ${(r.customer_last || '').trim()}`.trim() || '(no name)',
      service_state: r.service_state || '',
      service_city: r.service_city || '',
      service_zip: r.service_zip || '',
      inferred_state: inferred,
      fixable: !!inferred,
    });
  }
  out.sort((a, b) => (b.job_id || 0) - (a.job_id || 0));

  if (!doFix) return j(200, { ok: true, count: out.length, fixable: out.filter((x) => x.fixable).length, jobs: out });

  // FIX pass — only where the zip clearly maps to TN/LA. Correct the job's
  // service_state and the customer's state so the board/map/drawer all agree.
  const changed = [];
  for (const x of out) {
    if (!x.fixable) continue;
    try {
      await crud.update(crud.TABLES.jobs, x.job_id, { service_state: x.inferred_state });
      if (x.customer_id) { try { await crud.update(crud.TABLES.customer, x.customer_id, { state: x.inferred_state }); } catch (_) {} }
      await crud.logEvent('job_state_corrected', { job_id: x.job_id, from: x.service_state, to: x.inferred_state, zip: x.service_zip, by: 'office_cleanup', at_ms: Date.now() });
      changed.push({ job_id: x.job_id, from: x.service_state, to: x.inferred_state });
    } catch (e) { changed.push({ job_id: x.job_id, error: String(e && e.message || e) }); }
  }
  return j(200, { ok: true, fixed: changed.length, skipped_no_zip: out.filter((x) => !x.fixable).length, changed, still_unfixable: out.filter((x) => !x.fixable) });
};
