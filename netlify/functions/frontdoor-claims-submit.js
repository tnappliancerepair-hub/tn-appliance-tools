// frontdoor-claims-submit — files an AHS/Frontdoor claim (SmartAutho estimate + invoice) via
// the claim submission API. Assembles the claim from frontdoor-queue (already built end-to-end),
// then:
//   SHADOW (default): returns the EXACT payload it would submit + the build's "missing" gaps.
//   LIVE: requires ?live=1 & confirm=1 & admin secret + a configured submission endpoint.
// The submission endpoint/auth is the open Akshay question — this is fully wired + shadow-safe
// until FRONTDOOR_CLAIMS_PATH is set. Mirrors servicepower-claims-submit.js exactly.
//
//   GET ?secret=<admin>&job_id=<id>            build + shadow (nothing submitted)
//   GET ...&live=1&confirm=1                     actually submit (gated + configured only)
'use strict';
const claims = require('./_lib/frontdoor-claims');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const SITE = 'https://tnapplianceexchange.net';
const QUEUE_KEY = 'tn-frontdoor-2026';   // frontdoor-queue's access key
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const jobId = parseInt(String(q.job_id || '').replace(/\D/g, ''), 10) || 0;
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });

  // 1. assemble — reuse frontdoor-queue's already-built `fd` claim object for this job.
  let built;
  try {
    const r = await fetch(`${SITE}/.netlify/functions/frontdoor-queue?key=${QUEUE_KEY}&days=120`, { signal: AbortSignal.timeout(20000) }).then((x) => x.json());
    const jobs = (r && r.jobs) || [];
    built = jobs.filter((j) => String(j.job_id) === String(jobId))[0];
  } catch (e) { return json(200, { ok: false, error: 'build failed: ' + String((e && e.message) || e) }); }
  if (!built || !built.fd) return json(200, { ok: false, error: 'job not found in the AHS queue (must be a completed AHS/Frontdoor job with a TDR)', job_id: jobId });

  const claim = built.fd;
  const blockers = built.missing || [];   // labor hours / repair notes / dispatch # — hard gaps
  const configured = await claims.isConfigured();
  const live = q.live === '1' && q.confirm === '1';

  // 2. SHADOW (default) — assemble + show, submit nothing.
  if (!live) {
    try { await crud.logEvent('frontdoor_claim_shadow', { job_id: jobId, dispatch_id: claim.dispatch_id, configured, blockers, at_ms: Date.now() }); } catch (_) {}
    return json(200, {
      ok: true, mode: 'shadow', job_id: jobId, configured, blockers,
      would_submit: { claims: [claim] },
      note: configured
        ? 'SHADOW — nothing submitted. To file for real: &live=1&confirm=1 (after confirming the claim + codes look right).'
        : 'SHADOW + NOT CONFIGURED — the Frontdoor submission endpoint is unknown (awaiting Akshay). The claim is FULLY assembled; set FRONTDOOR_CLAIMS_PATH + confirm the payload/auth to enable live filing.',
    });
  }

  // 3. LIVE — gated on configured + no hard blockers.
  if (!configured) return json(200, { ok: false, mode: 'live-blocked', reason: 'submission endpoint not configured (FRONTDOOR_CLAIMS_PATH) — the open Akshay question', would_submit: { claims: [claim] } });
  if (blockers.length) return json(200, { ok: false, mode: 'live-blocked', blockers, note: 'Resolve the blockers before submitting.' });

  let res;
  try { res = await claims.submitClaims([claim]); } catch (e) { return json(200, { ok: false, mode: 'live', error: String((e && e.message) || e) }); }
  try { await crud.logEvent('frontdoor_claim_submitted', { job_id: jobId, dispatch_id: claim.dispatch_id, ok: res.ok, http_status: res.http_status, at_ms: Date.now() }); } catch (_) {}
  return json(200, { ok: res.ok, mode: 'live', job_id: jobId, http_status: res.http_status, response: res.data, raw_preview: res.ok ? undefined : res.raw });
};
