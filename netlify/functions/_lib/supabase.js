// supabase.js — thin PostgREST client for Ant's high-churn ops tables
// (event_log first), the structural cure for Xano melting under write load.
//
// Dependency-free: talks straight to Supabase's PostgREST over fetch, so it
// runs in Netlify functions AND can be mirrored into the colony loop with no
// npm install. Creds read VAULT-FIRST (same pattern as Digits/Marcone) so we
// never fight Netlify's 4KB env cap.
//
// Vault keys (set in admin-secrets.html):
//   SUPABASE_URL          e.g. https://abcdefgh.supabase.co
//   SUPABASE_SERVICE_KEY  the service_role key (server-side only — full access,
//                         bypasses RLS; NEVER ship to a browser)
//
// Use a FRESH project dedicated to Ant ops (kept clean of the bigger-idea build).
'use strict';

const { getSecretPreferVault } = require('./secrets');

let _cfg = null;
async function cfg() {
  if (_cfg) return _cfg;
  const [url, key] = await Promise.all([
    getSecretPreferVault('SUPABASE_URL'),
    getSecretPreferVault('SUPABASE_SERVICE_KEY'),
  ]);
  _cfg = { url: String(url || '').replace(/\/+$/, ''), key: String(key || '') };
  return _cfg;
}

async function isConnected() {
  const c = await cfg();
  return !!(c.url && c.key);
}

function headers(c, extra) {
  return {
    apikey: c.key,
    Authorization: 'Bearer ' + c.key,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

// INSERT rows into a table. Returns the inserted rows unless quiet=true.
async function insert(table, rows, { quiet = true } = {}) {
  const c = await cfg();
  if (!c.url || !c.key) throw new Error('supabase_not_configured');
  const body = Array.isArray(rows) ? rows : [rows];
  const r = await fetch(`${c.url}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(c, { Prefer: quiet ? 'return=minimal' : 'return=representation' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`supabase insert ${table} -> ${r.status}: ${t.slice(0, 200)}`);
  }
  return quiet ? { ok: true, count: body.length } : r.json();
}

// SELECT with PostgREST query params, e.g.
//   select('event_log', { action: 'eq.new_job_greeting_sent', order: 'created_at.desc', limit: 50 })
async function select(table, params = {}) {
  const c = await cfg();
  if (!c.url || !c.key) throw new Error('supabase_not_configured');
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${c.url}/rest/v1/${table}${qs ? '?' + qs : ''}`, {
    headers: headers(c),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`supabase select ${table} -> ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

// recordEvent — the event_log writer. Mirrors the Xano event_log row shape so
// office reads can swap source with no UI change. Best-effort by default: never
// throw into a caller's hot path (an audit write must not break a real action).
//   recordEvent({ action, job_id, customer_id, technician_id, metadata, company_id })
async function recordEvent(row, { throwOnError = false } = {}) {
  try {
    const r = {
      action: String(row.action || ''),
      job_id: row.job_id != null ? Number(row.job_id) : null,
      customer_id: row.customer_id != null ? Number(row.customer_id) : null,
      technician_id: row.technician_id != null ? Number(row.technician_id) : null,
      company_id: row.company_id != null ? Number(row.company_id) : 1, // multi-tenant from day one
      metadata: row.metadata != null ? row.metadata : {},
      source: row.source || 'netlify',
    };
    await insert('event_log', r);
    return { ok: true };
  } catch (err) {
    if (throwOnError) throw err;
    console.error('[supabase.recordEvent] ' + (err.message || err));
    return { ok: false, error: String(err.message || err) };
  }
}

module.exports = { cfg, isConnected, insert, select, recordEvent };
