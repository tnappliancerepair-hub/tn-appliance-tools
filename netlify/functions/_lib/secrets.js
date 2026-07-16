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

// VAULT-FIRST read — for keys whose Netlify env value is STALE and can't be
// edited (the 4KB cap blocks env saves). Checks the vault first, falls back to
// env only if the vault has nothing. (Doesn't cache the empty case, so a value
// added to the vault later is picked up on the next warm call.)
async function getSecretPreferVault(name) {
  try {
    const v = await fetchFromXano(name);
    if (v) { _secretCache[name] = v; return v; }
  } catch (err) {
    console.error('[secrets] getSecretPreferVault(' + name + ') failed:', err.message);
  }
  return process.env[name] || '';
}

// Upsert a secret into the vault — used when a function legitimately obtains a
// secret it should persist (e.g. the Digits OAuth callback saving the refresh
// token, so nobody pastes it into Netlify env). No PIN gate: callers are
// trusted server contexts already holding the metadata token.
async function setSecret(name, value) {
  const tid = await configTableId();
  // Verify the write actually landed and retry — a swallowed Xano hiccup here was
  // silently dropping runtime-flag writes (e.g. the Reach-Me toggle "flipping off by
  // itself": setSecret returned success but the value never persisted). 2026-07-16.
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const sr = await fetch(`${XANO_META}/table/${tid}/content/search`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ search: { name }, per_page: 5, page: 1 }),
      });
      const sd = sr.ok ? await sr.json() : { items: [] };
      const existing = ((sd && sd.items) || []).find((x) => x && x.name === name);
      const wr = existing
        ? await fetch(`${XANO_META}/table/${tid}/content/${existing.id}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ name, value }) })
        : await fetch(`${XANO_META}/table/${tid}/content`, { method: 'POST', headers: headers(), body: JSON.stringify({ name, value }) });
      if (wr && wr.ok) { _secretCache[name] = value; return true; }
      lastErr = 'write ' + (wr ? wr.status : 'no-response');
    } catch (e) { lastErr = String((e && e.message) || e); }
    await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
  }
  console.error('[secrets] setSecret(' + name + ') did NOT persist:', lastErr);
  return false;
}

// Always-fresh read (no cache) — for values that change at runtime, like the
// per-person Reach Me availability flags. Falls back to env on error.
async function getSecretFresh(name) {
  try { const v = await fetchFromXano(name); _secretCache[name] = v; return v; }
  catch (err) { return process.env[name] || ''; }
}

module.exports = { getSecret, getSecretFresh, getSecretPreferVault, setSecret, configTableId, CONFIG_TABLE_NAME };
