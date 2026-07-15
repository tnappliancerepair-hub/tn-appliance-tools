// pm-accounts — storage for property-management billing accounts. A PM account holds the
// Stripe customer id (Stripe securely stores the card — we never touch the PAN), the
// billing track (card-on-file vs net terms), the per-job auto-charge threshold, and
// contacts. Stored as latest-wins rows in event_log (action="pm_account") so we need no
// schema change (the metadata token is content-scoped). PM accounts are few, so reading the
// recent pm_account rows and taking the newest per pm_key is cheap + reliable.
'use strict';
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const EVENT_LOG = 3;
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
const s = (v) => String(v == null ? '' : v).trim();
function pmSlug(v) { return s(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }

async function _recent(perPage) {
  const r = await fetch(`${META}/table/${EVENT_LOG}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ search: { action: 'pm_account' }, sort: { id: 'desc' }, per_page: perPage || 400 }) });
  if (!r.ok) throw new Error('pm_account read -> ' + r.status);
  return ((await r.json()).items) || [];
}

// Latest profile for a PM (newest pm_account row whose metadata.pm_key matches).
async function getPmAccount(pmKey) {
  if (!pmKey) return null;
  const rows = await _recent(400);
  for (const row of rows) { const m = row.metadata || {}; if (m.pm_key === pmKey) return Object.assign({ pm_key: pmKey }, m); }
  return null;
}

// Merge patch over the current profile and write a fresh latest-wins row.
async function upsertPmAccount(pmKey, patch) {
  const cur = (await getPmAccount(pmKey)) || { pm_key: pmKey, created_ms: Date.now() };
  const next = Object.assign({}, cur, patch, { pm_key: pmKey, updated_ms: Date.now() });
  const r = await fetch(`${META}/table/${EVENT_LOG}/content`, { method: 'POST', headers: authH(), body: JSON.stringify({ action: 'pm_account', metadata: next }) });
  if (!r.ok) throw new Error('pm_account write -> ' + r.status);
  return next;
}

// All PM accounts, newest state per pm_key.
async function listPmAccounts() {
  const rows = await _recent(400);
  const seen = {}; const out = [];
  for (const row of rows) { const m = row.metadata || {}; const k = m.pm_key; if (!k || seen[k]) continue; seen[k] = 1; out.push(Object.assign({ pm_key: k }, m)); }
  return out;
}

module.exports = { getPmAccount, upsertPmAccount, listPmAccounts, pmSlug };
