// frontdoor-auth-watch — waits for Brian to link our key to the account.
//
// ⚠️ A 404 IS NOT AUTHORIZATION. The first cut treated any non-403 as "cleared", so it
// texted Teddy a false all-clear twice (2026-08-12, 2026-09-10) off a 404 — which means
// the path doesn't exist for us (wrong URL shape / not provisioned), not that the key
// was linked. Only a status that proves the endpoint ACCEPTED our token counts:
//   200/201/202  live
//   400/422      endpoint took the auth and rejected the body — a PASS
//   405          wrong method, but the path is real
// 403 = exists, not authorized (the genuine wait). 404 = wrong path (OUR fix, not theirs).
// Both stay quiet, but they're logged separately so the history reads true.
//
//   scheduled (netlify.toml) · ?dryrun=1 previews · ?force=1 re-alerts
'use strict';

const fd = require('./_lib/frontdoor');
const { sendSms } = require('./_lib/sms');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }
async function alreadyAlerted() {
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=frontdoor_auth_cleared&days_back=30&limit=5`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json(); return (((d && (d.items || d.rows)) || []).length > 0);
  } catch (_) { return false; }
}
async function logCleared(status) {
  try { await fetch(`${XANO}/record_event_log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'frontdoor_auth_cleared', metadata_json: JSON.stringify({ http_status: status, state: 'reachable', at_ms: Date.now() }) }) }); } catch (_) {}
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dry = q.dryrun === '1', force = q.force === '1';

  if (!(await fd.isConfigured())) return j(200, { ok: true, skipped: 'key_not_in_vault' });
  if (!force && await alreadyAlerted()) return j(200, { ok: true, skipped: 'already_alerted' });

  // Probe the dispatch endpoint (sandbox, harmless bogus dispatch). 403 = still
  // not linked; anything else = the key is authorized.
  let status = 0, err = '', body = '';
  try {
    // Probe PRODUCTION on purpose. Measured 2026-09-15: the sandbox gateway has zero routes
    // deployed (every path 404s, control included), so watching it would wait forever on a
    // host that serves nothing. /dispatch-connector is live + JWT-gated on production; while
    // we hold only a sandbox key it answers 401 "Jwt issuer is not configured". The day a
    // production key is vaulted, that 401 turns into something else — and that is the signal.
    const resp = await fd.dispatchStatusUpdate({ dispatchId: 1, statusCode: 70, description: 'Technician in Route to Location', vendorId: '839828', tenant: 'AHS', baseOverride: fd.PROD_BASE });
    status = Number(resp && resp.status) || 0;
    body = String((resp && resp.raw) || '').slice(0, 160);
  } catch (e) { err = String((e && e.message) || e).slice(0, 160); }

  // Only these prove the endpoint accepted our token. 404 deliberately excluded.
  const REACHABLE = [200, 201, 202, 400, 405, 422];
  const cleared = REACHABLE.includes(status);
  // 401 + "issuer is not configured" is the specific, expected state while we hold a
  // sandbox-only key: the service is right there and simply does not trust our issuer.
  const issuerUntrusted = status === 401 && /issuer is not configured/i.test(body);
  const state = cleared ? 'reachable'
    : issuerUntrusted ? 'issuer_not_trusted (need a PRODUCTION key)'
    : status === 403 ? 'not_authorized'
    : status === 404 ? 'path_not_found'
    : status === 401 ? 'token_rejected'
    : 'unknown';
  if (dry) return j(200, { ok: true, dryrun: true, probed: fd.PROD_BASE + '/dispatch-connector/v1/webhook', http_status: status, body, error: err, cleared, state });

  if (cleared) {
    await logCleared(status);
    const msg = '🚪✅ FRONTDOOR/AHS ENDPOINT ACCEPTED OUR KEY (HTTP ' + status + '). That is real authorization, not a 404. Ready to flip FRONTDOOR_PUSH_LIVE=1 and run the status-push test. — Ant';
    try { await sendSms(OWNER, msg, 'owner', 'frontdoor_auth_cleared'); } catch (_) {}
    return j(200, { ok: true, cleared: true, http_status: status, alerted: true });
  }
  return j(200, { ok: true, cleared: false, state, http_status: status || 0, body, error: err });
};
