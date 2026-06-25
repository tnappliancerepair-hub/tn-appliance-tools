// servicepower-claims-submit — files a SQUARE TRADE claim via the ServiceClaims submission
// API. Assembles the claim from a completed job+TDR (via servicepower-claims-build), then:
//   SHADOW (default): returns the EXACT payload it would submit + the build's "still needed"
//     gaps. Submits nothing.
//   LIVE: requires ?live=1 & confirm=1 & admin secret. Actually POSTs to /submission.
//
// Do NOT go live on a real claim without Teddy's OK + the official code lists refined.
//
//   GET ?secret=<admin>&job_id=<id>|&call=<dispatch#>   build + shadow
//   GET ...&live=1&confirm=1                              actually submit (gated)
'use strict';
const claims = require('./_lib/servicepower-claims');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const SITE = 'https://tnapplianceexchange.net';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (!(await claims.isConfigured())) return json(200, { ok: false, error: 'ServicePower creds not in vault' });

  // 1. assemble the claim from the completed job + TDR
  let built;
  try {
    const url = `${SITE}/.netlify/functions/servicepower-claims-build?secret=${encodeURIComponent(admin)}`
      + (q.job_id ? `&job_id=${encodeURIComponent(q.job_id)}` : '') + (q.call ? `&call=${encodeURIComponent(q.call)}` : '');
    built = await fetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
  } catch (e) { return json(200, { ok: false, error: 'build failed: ' + String((e && e.message) || e) }); }
  if (!built || !built.ok || !built.claim) return json(200, { ok: false, error: 'could not assemble claim', built });

  const claim = built.claim;
  const blockers = (built.still_needed || []).filter((s) => !/CODE LISTS|PARTS USED-vs-RETURN/i.test(s)); // hard gaps (codes are seeded)

  // 2. LIVE only with the flag + confirm + no hard blockers
  const goLive = q.live === '1' && q.confirm === '1';
  if (!goLive) {
    try { await crud.logEvent('sp_claim_submit_shadow', { job_id: built.job_id, claim_number: claim.callNumber, would_submit: true, blockers, at_ms: Date.now() }); } catch (_) {}
    return json(200, {
      ok: true, mode: 'shadow', job_id: built.job_id,
      blockers, code_mapping: built.code_mapping,
      would_submit: { authentication: { userId: '***', password: '***' }, claims: [claim] },
      note: 'SHADOW — nothing submitted. To file for real: &live=1&confirm=1 (after confirming the claim looks right + codes refined).',
    });
  }
  if (blockers.length) return json(200, { ok: false, mode: 'live-blocked', blockers, note: 'Resolve the blockers before submitting.' });

  // 3. real submit
  let res;
  try { res = await claims.submitClaims([claim]); } catch (e) { return json(200, { ok: false, mode: 'live', error: String((e && e.message) || e) }); }
  try { await crud.logEvent('sp_claim_submitted', { job_id: built.job_id, claim_number: claim.callNumber, ok: res.ok, response_code: res.response_code, transaction_id: res.transaction_id, messages: res.messages, at_ms: Date.now() }); } catch (_) {}
  return json(200, { ok: res.ok, mode: 'live', job_id: built.job_id, response_code: res.response_code, transaction_id: res.transaction_id, messages: res.messages, claims_resp: res.claims_resp, raw_preview: res.ok ? undefined : res.raw });
};
