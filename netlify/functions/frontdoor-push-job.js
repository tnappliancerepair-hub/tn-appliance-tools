// frontdoor-push-job — the job-scoped, browser-safe front door to the Frontdoor status
// push. The tech app / office can't call frontdoor-push-status directly (it needs the
// admin secret + the raw Frontdoor dispatch number). This wrapper takes just a job_id +
// a status_key, resolves the dispatch number + the right vendor account SERVER-SIDE, and
// calls frontdoor-push-status with the secret (which stays on the server). No-ops safely
// for any job that isn't an AHS/Frontdoor dispatch, so the tech lifecycle can fire it on
// every tap. SHADOW until FRONTDOOR_PUSH_LIVE=1 + the sandbox key is authorized.
//
//   POST { job_id, status_key, note?, technician_id? }
//     status_key ∈ _lib/frontdoor STATUS  (EN_ROUTE | ARRIVED | IN_PROGRESS | COMPLETE | …)
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const { composeTdrNote } = require('./_lib/frontdoor-tdr');

const FN = 'https://tnapplianceexchange.net/.netlify/functions';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'content-type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
const FD_RE = /ahs|american home shield|frontdoor|home shield|hsa|2-?10|two-?ten/i;

// Which vendor account do we push under? Prefer a vendor stamped on the job (once the
// inbound webhook stores it); else resolve from state + tech. Confirmed IDs 2026-07-09:
//   822418 = LA North Shore (John, tech 6) · 822218 = LA South Shore (Andre, tech 3)
//   839828 = Middle TN crew (Jimmy 2 / Lee 4 / Teddy 1)
function resolveVendor(job, techOverride) {
  const stamped = String(job.frontdoor_vendor_id || '').trim();
  if (stamped) return stamped;
  const tech = parseInt(techOverride || job.technician_id, 10) || 0;
  if (tech === 6) return '822418';
  if (tech === 3) return '822218';
  const st = String(job.service_state || '').toUpperCase();
  if (st === 'LA') return '822218';   // LA default → South Shore (Andre)
  return '839828';                     // TN crew
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  const statusKey = String(b.status_key || '').trim().toUpperCase();
  if (!jobId || !statusKey) return json(400, { ok: false, error: 'job_id and status_key required' });

  let job = {};
  try { job = (await crud.searchOne(crud.TABLES.jobs, { id: jobId })) || {}; } catch (_) {}

  // Gate: only AHS/Frontdoor-family jobs. (SquareTrade/NSA go through servicepower-push.)
  const wc = String(job.warranty_company || '');
  if (!FD_RE.test(wc)) return json(200, { ok: true, skipped: 'not_frontdoor' });

  const dispatchNumber = String(job.dispatch_source_id || job.claim_number || '').trim();
  if (!dispatchNumber) return json(200, { ok: true, skipped: 'no_dispatch_number' });

  const vendorId = resolveVendor(job, b.technician_id);
  const secret = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';

  // On COMPLETE, send the WHOLE TDR to the portal as the dispatch note (diagnosis, failed
  // part + #, work performed, labor, parts-to-return) — composed server-side from the saved
  // TDR so it's complete + consistent regardless of what the tech typed. This is the "the
  // TDR files itself to the portal" step; the full structured estimate/invoice auto-submit
  // is Phase 2 (waits on Frontdoor confirming a claims-submission API — see the plan doc).
  let note = String(b.note || '').trim();
  if (statusKey === 'COMPLETE') {
    try {
      const br = await fetch(`${XANO}/get_warranty_card_bundle_for_jobs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids_csv: String(jobId) }), signal: AbortSignal.timeout(9000),
      }).then((x) => x.json()).catch(() => null);
      const bundle = ((br && br.bundles) || []).find((x) => String(x.job_id) === String(jobId)) || ((br && br.bundles) || [])[0];
      const tdrNote = bundle ? composeTdrNote(bundle) : '';
      if (tdrNote) note = tdrNote + (b.note ? ' — ' + String(b.note).trim() : '');
    } catch (_) {}
  }

  // Hand off to the single push path (it owns shadow/live + logging). Secret stays server-side.
  try {
    const r = await fetch(`${FN}/frontdoor-push-status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, dispatch_number: dispatchNumber, status_key: statusKey, note: note || undefined, vendor_id: vendorId, tenant: 'AHS' }),
      signal: AbortSignal.timeout(12000),
    });
    const d = await r.json().catch(() => ({}));
    return json(200, { ok: !!(d && d.ok), mode: d && d.mode, dispatch_number: dispatchNumber, vendor_id: vendorId, detail: d });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 160) });
  }
};
