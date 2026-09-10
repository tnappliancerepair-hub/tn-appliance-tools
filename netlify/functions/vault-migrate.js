// vault-migrate — copy the secret vault out of Xano and into Supabase.
//
// The vault lived in Xano, which made a slow Xano an outage for every platform function
// (measured 2026-09-10: ~20% of office actions failing at once). secrets.js now reads
// Supabase first and falls back to Xano, so this is the one-time copy that lets the
// primary leg actually resolve. Re-runnable: an upsert, so running it twice is a no-op.
//
// NEVER returns a secret value — only names, lengths and counts.
//   ?secret=<admin>[&dryrun=1]
'use strict';

const { getSecret, configTableId, SB_VAULT_URL } = require('./_lib/secrets');

const XANO_META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  const dry = q.dryrun === '1';

  const xtok = process.env.XANO_METADATA_TOKEN || (await getSecret('XANO_METADATA_TOKEN'));
  const sbKey = process.env.PLATFORM_SUPABASE_SERVICE_KEY || (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY'));
  if (!xtok) return json(200, { ok: false, error: 'no XANO_METADATA_TOKEN' });
  if (!sbKey) return json(200, { ok: false, error: 'no PLATFORM_SUPABASE_SERVICE_KEY' });

  // 1) read every row out of the Xano-hosted vault
  const tid = await configTableId();
  const rows = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${XANO_META}/table/${tid}/content/search`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + xtok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ search: {}, sort: { id: 'asc' }, per_page: 200, page }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return json(200, { ok: false, error: 'xano read ' + r.status, copied: 0 });
    const items = (await r.json()).items || [];
    if (!items.length) break;
    for (const it of items) {
      const name = String(it.name || '').trim();
      if (name) rows.push({ name, value: String(it.value || '') });
    }
    if (items.length < 200) break;
  }

  const manifest = rows.map((r) => ({ name: r.name, bytes: r.value.length }));
  if (dry) return json(200, { ok: true, dryrun: true, found: rows.length, manifest });

  // 2) upsert into Supabase, in chunks
  let copied = 0; const failed = [];
  const H = { apikey: sbKey, Authorization: 'Bearer ' + sbKey, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50).map((r) => ({ ...r, updated_at: now }));
    try {
      const r = await fetch(`${SB_VAULT_URL}/rest/v1/app_config?on_conflict=name`, {
        method: 'POST', headers: H, body: JSON.stringify(chunk), signal: AbortSignal.timeout(20000),
      });
      if (r.ok) copied += chunk.length;
      else failed.push('chunk@' + i + ' ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
    } catch (e) { failed.push('chunk@' + i + ' ' + String((e && e.message) || e).slice(0, 80)); }
  }

  // 3) prove it by reading back names only
  let landed = 0;
  try {
    const v = await fetch(`${SB_VAULT_URL}/rest/v1/app_config?select=name`, { headers: { apikey: sbKey, Authorization: 'Bearer ' + sbKey }, signal: AbortSignal.timeout(15000) });
    if (v.ok) landed = ((await v.json()) || []).length;
  } catch (_) {}

  return json(200, { ok: failed.length === 0, found: rows.length, copied, landed_in_supabase: landed, failed, manifest });
};
