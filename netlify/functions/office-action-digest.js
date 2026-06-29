// office-action-digest — Danielle's reliable EMAIL channel for actionable jobs.
//
// The problem (Danielle, 2026-06-29): actionable alerts (add-ons to install, e.g.
// "David Randall said YES to the $50 water line on job #19939 — bring + install")
// come as SMS and get BURIED in the text flood (1400+ unread) → they get missed.
// "I need an email." This emails her the open add-ons she still has to act on,
// firing only when there's something NEW since the last digest (no spam), with the
// full open list as context.
//
// Source: addons-pending (addon_requested minus fulfilled/voided). Sends via the
// SES send-email primitive — so it's DORMANT until email is turned on
// (EMAIL_ENABLED=true + the SES recipient verify). Until then it dry-runs safely.
//
//   scheduled hourly (business hrs)   email Danielle when a new add-on appears
//   GET ?dry=1                        compute + show, send nothing
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const SITE = (process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
const TO = process.env.OFFICE_DIGEST_EMAIL || 'danielle.tnappliance@gmail.com';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  const dry = (event.queryStringParameters || {}).dry === '1';

  // 1. open add-ons (the actionable list)
  let open = [];
  try {
    const r = await fetch(`${SITE}/.netlify/functions/addons-pending`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    open = (d && d.items) || [];
  } catch (e) { return json(200, { ok: false, error: 'addons-pending: ' + String(e.message || e) }); }

  const keyOf = (x) => `${x.job_id}|${x.addon_key}`;
  const openKeys = open.map(keyOf);

  // 2. which have we already emailed? (dedup so a still-open item doesn't re-nag)
  const emailed = new Set();
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'office_action_digest_sent' }, { id: 'desc' }, 60);
    for (const r of rows || []) { for (const k of (meta(r).keys || [])) emailed.add(k); }
  } catch (_) {}

  const fresh = open.filter((x) => !emailed.has(keyOf(x)));
  const out = { ok: true, dry, open: open.length, new: fresh.length };

  if (!fresh.length) { out.note = 'no new add-ons since last digest — no email'; return json(200, out); }

  // 3. build the email — full open list, new ones flagged
  const line = (x) => {
    const isNew = !emailed.has(keyOf(x));
    const price = x.net_price ? ` ~$${x.net_price}` : '';
    const mode = x.mode === 'ship' ? 'SHIP to customer' : (x.mode === 'inquire' ? 'QUOTE requested' : 'install');
    return `${isNew ? '🆕 ' : '• '}Job #${x.job_id} — ${x.name || x.addon_key}${price} (${mode})  →  ${SITE}/office-board.html?job=${x.job_id}`;
  };
  const body =
    `${fresh.length} new add-on${fresh.length === 1 ? '' : 's'} a customer said YES to — bring + install + add to the ticket.\n\n` +
    `── OPEN ADD-ONS (${open.length}) ──\n` +
    open.map(line).join('\n') +
    `\n\nOpen the board to fulfill each: ${SITE}/office-board.html\n(You're getting this email because these get buried in texts.)`;
  const subject = `🔧 ${fresh.length} new add-on${fresh.length === 1 ? '' : 's'} to install — TN Appliance`;

  if (dry) { out.subject = subject; out.body_preview = body.slice(0, 600); return json(200, out); }

  // 4. send via the SES primitive (dormant until EMAIL_ENABLED=true)
  let sent = { ok: false };
  try {
    const r = await fetch(`${SITE}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Internal-Auth': process.env.EMAIL_SHARED_SECRET || '' },
      body: JSON.stringify({ to: TO, subject, body }),
      signal: AbortSignal.timeout(15000),
    });
    sent = await r.json().catch(() => ({ ok: false }));
  } catch (e) { sent = { ok: false, error: String(e.message || e) }; }

  // 5. record what we emailed so we don't re-nag — ONLY on a real LIVE send. A
  // dry-run (EMAIL_ENABLED off) returns ok:true too; recording it would burn the
  // item so it never emails once email is on.
  if (sent && sent.ok && sent.mode === 'live') {
    try { await crud.logEvent('office_action_digest_sent', { keys: openKeys, new_keys: fresh.map(keyOf), count: open.length, mode: sent.mode || 'live', at_ms: Date.now() }); } catch (_) {}
  }
  out.email = sent;
  out.summary = `${fresh.length} new of ${open.length} open · email ${sent && sent.ok ? (sent.mode || 'sent') : 'FAILED'}`;
  return json(200, out);
};
