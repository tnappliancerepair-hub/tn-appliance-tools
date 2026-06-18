// marcone-health — quick "is Marcone wired up?" probe. Token-gated so it can't
// be hammered. Reports which vault keys are present (masked) + whether a live
// lookup succeeds once the endpoint paths in _lib/marcone.js are filled in.
//
//   GET /.netlify/functions/marcone-health?token=tn-marcone-dbg-2026[&model=WTW5000DW1]
'use strict';

const marcone = require('./_lib/marcone');
const { getSecretPreferVault } = require('./_lib/secrets');

const TOKEN = 'tn-marcone-dbg-2026';

function j(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) };
}
function mask(v) {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 8) return s.slice(0, 2) + '…';
  return s.slice(0, 4) + '…' + s.slice(-3);
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.token !== TOKEN) return j(401, { ok: false, error: 'bad_token' });

  // Which creds are present (masked — never echo full secrets).
  const keys = ['MARCONE_API_BASE', 'MARCONE_API_KEY', 'MARCONE_CLIENT_ID', 'MARCONE_CLIENT_SECRET', 'MARCONE_ACCOUNT_NUMBER'];
  const present = {};
  for (const k of keys) {
    try { present[k] = mask(await getSecretPreferVault(k)); }
    catch (_) { present[k] = null; }
  }

  let connected = false;
  try { connected = await marcone.isConnected(); } catch (_) {}

  const out = {
    ok: true,
    connected,                       // base + (key OR client_id/secret) all set
    auth_mode: present.MARCONE_API_KEY ? 'api_key' : (present.MARCONE_CLIENT_ID ? 'oauth2' : 'none'),
    keys_present: present,
    note: connected
      ? 'Creds present. Fill the TODO(docs) endpoint paths in _lib/marcone.js, then re-run with &model= to test a live lookup.'
      : 'Set MARCONE_API_BASE + (MARCONE_API_KEY or MARCONE_CLIENT_ID/SECRET) in admin-secrets.html.',
  };

  // Optional live lookup test (only once the endpoint paths are filled in).
  if (q.model && connected) {
    try {
      const candidates = await marcone.lookup(q.model, { type: q.type || 'part' });
      out.lookup_test = { model: q.model, count: candidates.length, sample: candidates.slice(0, 3) };
    } catch (e) {
      out.lookup_test = { model: q.model, error: String(e.message || e) };
    }
  }

  return j(200, out);
};
