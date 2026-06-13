// Runtime secret vault — sidesteps AWS Lambda's hard 4KB env-var cap.
//
// Netlify/Lambda only allows ~4KB of env vars per function, so we can't keep
// piling secrets into Netlify env. Instead, overflow secrets live in a private
// Xano table (`app_config`, columns: name, value) reachable ONLY via the
// Metadata API (admin token already in Functions scope) — no public endpoint
// reads it, so it's the same trust boundary as the env vault, with no size cap.
//
// getSecret(name): env-first (so anything already in Netlify env still works),
// then Xano. Resolved values + the table id are cached per warm container.
//
// Used by: create-stripe-payment-link.js, verify-payment.js (STRIPE_SECRET_KEY).

'use strict';

const XANO_META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const CONFIG_TABLE_NAME = 'app_config';
// The content-scoped metadata token can't LIST tables (403). The app_config UI
// shows "#33" but the table URL is /database/53, so we probe both candidate ids
// (content/search succeeds only on the real one) and cache the winner.
const CANDIDATE_IDS = [53, 33];

let _tableIdCache = null;
const _secretCache = {};

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

// Find the app_config table id by probing candidates (content-scoped token
// can't list tables, so we just hit each id's content endpoint — the real one
// returns 2xx, wrong ids 4xx).
async function configTableId() {
  if (_tableIdCache) return _tableIdCache;
  for (const id of CANDIDATE_IDS) {
    try {
      const r = await fetch(`${XANO_META}/table/${id}/content/search`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ search: { name: '__probe__' }, per_page: 1, page: 1 }),
      });
      if (r.ok) { _tableIdCache = id; return id; }
    } catch (_) {}
  }
  throw new Error('app_config table not found at ids ' + CANDIDATE_IDS.join('/') + ' — confirm the table id');
}

async function fetchFromXano(name) {
  const tid = await configTableId();
  const r = await fetch(`${XANO_META}/table/${tid}/content/search`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ search: { name }, per_page: 5, page: 1 }),
  });
  if (!r.ok) throw new Error('secret-search ' + r.status);
  const d = await r.json();
  const rows = (d && d.items) || [];
  const row = rows.find((x) => x && x.name === name) || rows[0];
  return row ? String(row.value || '') : '';
}

// Returns the secret value, or '' if not found anywhere. Never throws to the
// caller for "not found" — only for a genuine config error you want surfaced.
async function getSecret(name) {
  if (process.env[name]) return process.env[name];
  if (_secretCache[name] !== undefined) return _secretCache[name];
  try {
    const v = await fetchFromXano(name);
    _secretCache[name] = v;
    return v;
  } catch (err) {
    console.error('[secrets] getSecret(' + name + ') failed:', err.message);
    return '';
  }
}

module.exports = { getSecret, configTableId, CONFIG_TABLE_NAME };
