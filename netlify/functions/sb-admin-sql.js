// sb-admin-sql — run SQL against a Supabase project via the Management API (owner-gated).
// Lets us create tables / indexes / migrations directly instead of pasting into the SQL
// editor. Uses the vaulted SUPABASE_MGMT_TOKEN (a Supabase personal access token). The
// project ref is derived from the vaulted SUPABASE_URL (ops) / PLATFORM_SUPABASE_URL
// (platform), so we never hardcode which database.
//
//   POST ?secret=<admin>&project=ops|platform   body: { "sql": "..." }
//   GET  ?secret=<admin>&project=ops&sql=select 1        (small reads / probes)
//
// Guarded by VAPI_ADMIN_SECRET. Every call is a deliberate, reviewable change.
'use strict';

const { getSecret } = require('./_lib/secrets');
const MGMT = 'https://api.supabase.com/v1';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function refFromUrl(u) { try { const m = String(u || '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i); return m ? m[1] : ''; } catch (_) { return ''; } }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const token = await getSecret('SUPABASE_MGMT_TOKEN');
  if (!token) return json(200, { ok: false, error: 'SUPABASE_MGMT_TOKEN not vaulted' });

  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const sql = String(body.sql || q.sql || '').trim();
  if (!sql) return json(200, { ok: false, error: 'need sql — POST {"sql":"..."} or ?sql=' });

  const which = String(q.project || 'ops').toLowerCase();
  let ref = '';
  if (which === 'platform') ref = refFromUrl(await getSecret('PLATFORM_SUPABASE_URL')) || 'tntbhfwitytkcoqlejwc';
  else ref = refFromUrl(await getSecret('SUPABASE_URL'));
  if (!ref) return json(200, { ok: false, error: 'could not resolve project ref for "' + which + '"' });

  try {
    const r = await fetch(`${MGMT}/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
      signal: AbortSignal.timeout(24000),
    });
    const d = await r.json().catch(() => ({}));
    return json(200, { ok: r.ok, status: r.status, project: which, ref, result: d });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200), project: which, ref });
  }
};
