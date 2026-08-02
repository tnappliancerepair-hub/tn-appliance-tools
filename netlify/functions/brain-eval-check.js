// brain-eval-check.js — owner-gated verification that the forward-eval harness is
// wired: (1) Supabase creds are set + reachable, and (2) the brain_predictions
// table exists in the project those creds point to. Run after applying
// docs/sql/001_brain_eval.sql.  GET ?secret=<admin>
'use strict';
const sb = require('./_lib/supabase');
const { getSecret } = require('./_lib/secrets');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  let connected = false, tableOk = false, rowCount = null, err = null;
  try { connected = await sb.isConnected(); } catch (e) { err = String((e && e.message) || e); }
  if (connected) {
    try {
      const rows = await sb.select('brain_predictions', { select: 'id', limit: '1' });
      tableOk = Array.isArray(rows);
    } catch (e) { err = String((e && e.message) || e); }
    // best-effort total count (PostgREST HEAD count would be cleaner; keep it simple)
    if (tableOk) {
      try { const all = await sb.select('brain_predictions', { select: 'id', limit: '1000' }); rowCount = all.length; } catch (_) {}
    }
  }
  return json(200, {
    ok: true,
    supabase_connected: connected,
    brain_predictions_table: tableOk,
    rows_seen: rowCount,
    next: !connected ? 'vault SUPABASE_URL + SUPABASE_SERVICE_KEY'
      : !tableOk ? 'run docs/sql/001_brain_eval.sql in the ANT OPS project SQL editor'
      : 'ready — eval harness is live',
    error: err,
  });
};
