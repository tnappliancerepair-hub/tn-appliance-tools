// verify-helper-pin — server-side PIN check for scoped helper pages (Carrie's
// Reports Desk). PINs are registered as a latest-wins event_log marker
// ('helper_pin_v1', metadata {name, role, pin_sha256}) so they're never in the
// page source and can be rotated without a deploy. We compare a SHA-256 of the
// entered PIN — the raw PIN is never stored or returned.
//
//   POST { pin, name? }  ->  { ok, name, role }   (ok:false on mismatch)
//
// Note: this is a light login for a reports-ONLY page (no scheduling/cancel), and
// the underlying report editor (Teddy Tool) already opens by job_id — so this is
// "whose desk is this" scoping, not a hard security boundary.
'use strict';

const crypto = require('crypto');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function sha(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const pin = String(b.pin || '').replace(/\D/g, '');
  const wantName = String(b.name || '').trim().toLowerCase();
  if (pin.length < 4) return j(200, { ok: false, error: 'enter your 4-digit PIN' });

  let rows = [];
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=helper_pin_v1&days_back=3650&limit=1000`, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    rows = (d && (d.items || d.rows)) || [];
  } catch (_) { return j(200, { ok: false, error: 'try again in a moment' }); }

  // Latest-wins per helper name.
  const latest = {};
  for (const row of rows) {
    const m = asObj(row.metadata); const nm = String(m.name || '').toLowerCase(); if (!nm) continue;
    const at = Number(row.created_at) || Number(m.at_ms) || 0;
    if (!latest[nm] || at > latest[nm].at) latest[nm] = { at, hash: String(m.pin_sha256 || ''), role: m.role || 'reports' };
  }

  const want = sha(pin);
  // If a name was passed, only that helper; else match any registered helper.
  const names = wantName ? [wantName] : Object.keys(latest);
  for (const nm of names) {
    const rec = latest[nm];
    if (rec && rec.hash && rec.hash.length === want.length && crypto.timingSafeEqual(Buffer.from(rec.hash), Buffer.from(want))) {
      return j(200, { ok: true, name: nm, role: rec.role });
    }
  }
  return j(200, { ok: false, error: 'that PIN didn\'t match' });
};
