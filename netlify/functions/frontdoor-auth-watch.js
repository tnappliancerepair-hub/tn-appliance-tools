// frontdoor-auth-watch — waits for Brian to link our sandbox key to the account.
// Probes the Frontdoor dispatch endpoint a few times a day; while it returns 403
// the key isn't authorized yet (stay quiet). The moment it returns anything OTHER
// than 403, the key is LIVE — text Teddy once so we can flip FRONTDOOR_PUSH_LIVE=1
// and run the real status-push test. Dedup so it alerts only on the transition.
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
  try { await fetch(`${XANO}/record_event_log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'frontdoor_auth_cleared', metadata_json: JSON.stringify({ http_status: status, at_ms: Date.now() }) }) }); } catch (_) {}
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dry = q.dryrun === '1', force = q.force === '1';

  if (!(await fd.isConfigured())) return j(200, { ok: true, skipped: 'key_not_in_vault' });
  if (!force && await alreadyAlerted()) return j(200, { ok: true, skipped: 'already_alerted' });

  // Probe the dispatch endpoint (sandbox, harmless bogus dispatch). 403 = still
  // not linked; anything else = the key is authorized.
  let status = 0, err = '';
  try {
    const resp = await fd.dispatchStatusUpdate({ dispatchId: 1, statusCode: 70, description: 'Technician in Route to Location', vendorId: '822418', tenant: 'AHS' });
    status = Number(resp && resp.status) || 0;
  } catch (e) { err = String((e && e.message) || e).slice(0, 160); }

  const cleared = status && status !== 403;
  if (dry) return j(200, { ok: true, dryrun: true, http_status: status, error: err, cleared });

  if (cleared) {
    await logCleared(status);
    const msg = '🚪✅ FRONTDOOR/AHS KEY IS LIVE — the 403 cleared (endpoint now returns ' + status + '). Brian linked the key. Ready to flip FRONTDOOR_PUSH_LIVE=1 and run the real status-push test. — Ant';
    try { await sendSms(OWNER, msg, 'owner', 'frontdoor_auth_cleared'); } catch (_) {}
    return j(200, { ok: true, cleared: true, http_status: status, alerted: true });
  }
  return j(200, { ok: true, cleared: false, http_status: status || '403/err', error: err });
};
