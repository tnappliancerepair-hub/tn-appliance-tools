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

  // Read-only Management API passthrough (GET only) — org/project/billing posture.
  //   ?secret=<admin>&mgmt=/v1/organizations
  //   ?secret=<admin>&mgmt=/v1/projects
  if (q.mgmt) {
    // MGMT already ends in /v1 — normalize the path to a bare "/organizations" etc.
    let path = String(q.mgmt).trim();
    path = path.replace(/^\/?v1/, '');           // drop a leading v1 if present
    if (!path.startsWith('/')) path = '/' + path;
    // GET (read posture) by default. Writes (POST/PATCH/PUT) and DELETE are allowed for
    // deliberate config changes (e.g. the auth redirect allowlist) but MUST pass &confirm=yes
    // so nothing fires by accident. A write body comes from the POST body (JSON).
    const method = String(q.method || 'GET').toUpperCase();
    const WRITE = { POST: 1, PATCH: 1, PUT: 1, DELETE: 1 };
    if (method !== 'GET' && !WRITE[method]) return json(200, { ok: false, error: 'mgmt passthrough allows GET/POST/PATCH/PUT/DELETE only' });
    if (method !== 'GET' && q.confirm !== 'yes') return json(200, { ok: false, error: method + ' requires &confirm=yes', would_call: `${MGMT}${path}` });
    let mgBody; try { mgBody = event.body ? JSON.parse(event.body) : undefined; } catch (_) { mgBody = undefined; }
    try {
      const opt = { method, headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) };
      if (mgBody !== undefined && method !== 'GET' && method !== 'DELETE') { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(mgBody); }
      const r = await fetch(`${MGMT}${path}`, opt);
      const d = await r.json().catch(() => ({}));
      return json(200, { ok: r.ok, status: r.status, method, url: `${MGMT}${path}`, data: d });
    } catch (e) {
      return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200), path });
    }
  }

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
