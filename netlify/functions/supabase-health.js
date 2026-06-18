// supabase-health — verify the Supabase ops project is wired + reachable.
// Token-gated. Confirms creds are in the vault, the event_log table exists, and
// a round-trip insert/read works. Run this right after vaulting the creds + SQL.
//
//   GET /.netlify/functions/supabase-health?token=tn-supabase-dbg-2026
'use strict';

const supa = require('./_lib/supabase');
const { getSecret } = require('./_lib/secrets');

const TOKEN = 'tn-supabase-dbg-2026';

function j(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) };
}
function mask(v) {
  if (!v) return null;
  const s = String(v);
  return s.length <= 8 ? s.slice(0, 2) + '…' : s.slice(0, 6) + '…' + s.slice(-4);
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.token !== TOKEN) return j(401, { ok: false, error: 'bad_token' });

  const url = await getSecret('SUPABASE_URL').catch(() => null);
  const key = await getSecret('SUPABASE_SERVICE_KEY').catch(() => null);
  const connected = await supa.isConnected().catch(() => false);

  const out = {
    ok: true,
    connected,
    url: url ? String(url) : null,        // URL isn't secret
    service_key: mask(key),
    note: connected
      ? 'Creds present. If round_trip below failed, run the schema SQL from docs/supabase-event-log-migration.md.'
      : 'Set SUPABASE_URL + SUPABASE_SERVICE_KEY in admin-secrets.html.',
  };

  if (connected) {
    try {
      const probe = { action: 'supabase_health_probe', metadata: { at: Date.now() }, source: 'health' };
      await supa.recordEvent(probe, { throwOnError: true });
      const rows = await supa.select('event_log', { action: 'eq.supabase_health_probe', order: 'created_at.desc', limit: 1 });
      out.round_trip = { ok: true, read_back: Array.isArray(rows) ? rows.length : 0 };
    } catch (e) {
      out.round_trip = { ok: false, error: String(e.message || e) };
    }
  }

  return j(200, out);
};
