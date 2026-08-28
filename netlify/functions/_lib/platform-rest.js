// platform-rest — one tiny PostgREST client for the ANT Platforms Supabase project,
// server-side only, using the SERVICE key from the vault (bypasses RLS — never the browser).
// Billing, the Stripe webhook, and the feature-gating helper all read/write through this so
// there's one code path. If the platform isn't configured, platform() returns null and every
// caller no-ops gracefully.
'use strict';

const { getSecret } = require('./secrets');

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key: String(key) };
}

function client(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const t = () => AbortSignal.timeout(8000);
  return {
    async get(path) {
      const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: t() });
      return r.ok ? r.json() : [];
    },
    async insert(table, row) {
      const r = await fetch(`${base}/rest/v1/${table}`, {
        method: 'POST', headers: { ...H, Prefer: 'return=representation' },
        body: JSON.stringify(row), signal: t(),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error((d && (d.message || d.hint)) || ('insert ' + table + ' ' + r.status));
      return Array.isArray(d) ? d[0] : d;
    },
    // patch(table, "id=eq.<uuid>", {cols}) — filter is a raw PostgREST query string
    async patch(table, filter, patch) {
      const r = await fetch(`${base}/rest/v1/${table}?${filter}`, {
        method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
        body: JSON.stringify(patch), signal: t(),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error((d && (d.message || d.hint)) || ('patch ' + table + ' ' + r.status));
      return Array.isArray(d) ? d : (d ? [d] : []);
    },
  };
}

// Returns a configured client, or null when the platform creds aren't vaulted.
async function platform() {
  const { url, key } = await cfg();
  if (!url || !key) return null;
  return client(url, key);
}

module.exports = { platform, cfg, client };
