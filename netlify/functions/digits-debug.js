// digits-debug — pinpoints why the Digits token exchange fails. Reports, for
// each Digits credential, WHERE it's coming from (vault vs stale env), its
// length, and a masked prefix/suffix — WITHOUT revealing the secret. Token-gated.
//
//   GET /.netlify/functions/digits-debug?token=tn-digits-dbg-2026
'use strict';

const { configTableId } = require('./_lib/secrets');
const XANO_META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const TOKEN = 'tn-digits-dbg-2026';
const KEYS = ['DIGITS_CLIENT_ID', 'DIGITS_CLIENT_SECRET', 'DIGITS_REFRESH_TOKEN'];

function mask(v) {
  if (!v) return null;
  const s = String(v);
  return { length: s.length, prefix: s.slice(0, 4), suffix: s.slice(-3), has_spaces: /\s/.test(s) };
}

async function vaultValue(name) {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) return { error: 'no_meta_token' };
  const tid = await configTableId();
  const r = await fetch(`${XANO_META}/table/${tid}/content/search`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ search: { name }, per_page: 5, page: 1 }),
  });
  if (!r.ok) return { error: 'search_' + r.status };
  const d = await r.json();
  const rows = (d && d.items) || [];
  const matches = rows.filter((x) => x && x.name === name);
  const row = matches[0];
  return { rows_with_this_exact_name: matches.length, value: row ? mask(row.value) : null };
}

exports.handler = async function (event) {
  if (((event.queryStringParameters || {}).token || '') !== TOKEN) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'bad token' }) };
  }
  const out = {};
  for (const name of KEYS) {
    let vault = null; try { vault = await vaultValue(name); } catch (e) { vault = { error: String(e.message || e) }; }
    out[name] = { vault, env: mask(process.env[name]) || 'not_set', used: vault && vault.value ? 'VAULT' : (process.env[name] ? 'ENV (stale!)' : 'MISSING') };
  }
  // Also list all names in the vault so we can spot a typo'd key name.
  let allNames = [];
  try {
    const tid = await configTableId();
    const r = await fetch(`${XANO_META}/table/${tid}/content?per_page=100&page=1`, {
      headers: { Authorization: 'Bearer ' + process.env.XANO_METADATA_TOKEN },
    });
    if (r.ok) { const d = await r.json(); allNames = ((d && d.items) || []).map((x) => x && x.name).filter(Boolean); }
  } catch (_) {}
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, keys: out, all_vault_names: allNames }, null, 2) };
};
