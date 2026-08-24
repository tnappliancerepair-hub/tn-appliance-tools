// trial-ann-lead — the ONE tool a free-trial Ann calls. Ann answers the shop's phone,
// captures the caller's info, and fires this to text the LEAD straight to the shop
// owner's cell (so a real hot lead hits their phone the second the call ends — the
// whole promise of "someone always answers"). No database, no scheduling — just:
// capture -> text the owner. That's the trial.
//
//   POST ?do=capture_lead&shop=<slug>  { name, phone, city, summary,
//                                         appliance?/problem? | vehicle?/issue? }
//   POST ?do=message_owner&shop=<slug> { message }   (free-form note to the owner)
//   GET  ?shop=<slug>&do=ping                          (harness — confirms wiring)
//
// Optional ?k=<TELNYX_TOOL_SECRET> gate (matches the main Ann tool); ungated if unset.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const shops = require('./_lib/trial-shops');
let createLeadJob = null; try { ({ createLeadJob } = require('./_lib/platform-db')); } catch (_) {}
let crud = null; try { crud = require('./_lib/xano/metadata-crud'); } catch (_) {}

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }
function fmtPhone(p) { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? d.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') : String(p || ''); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'content-type': 'application/json' }, body: '' };
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const p = Object.assign({}, body, q);   // Telnyx sends body params; allow query for the harness
  const doo = String(q.do || p.do || 'capture_lead');
  const slug = String(q.shop || p.shop || '').toLowerCase().trim();

  // Optional tool-key gate (same as the main Ann tool). Ungated when TELNYX_TOOL_SECRET
  // isn't set (trial/shadow) so wiring is never blocked by a missing secret.
  const key = await getSecret('TELNYX_TOOL_SECRET');
  if (key && q.k !== key && p.k !== key) return json(403, { ok: false, error: 'forbidden' });

  const shop = shops.get(slug);
  if (!shop) return json(200, { ok: false, error: 'unknown shop: ' + slug });
  if (doo === 'ping') return json(200, { ok: true, shop: shop.name, type: shop.type, owner_cell_set: !!shop.ownerCell });
  if (!shop.ownerCell) return json(200, { ok: false, error: 'shop has no ownerCell configured' });

  const name = String(p.name || '').trim();
  const phone = String(p.phone || '').trim();
  const city = String(p.city || '').trim();

  if (doo === 'message_owner') {
    const note = String(p.message || '').trim();
    if (!note) return json(200, { ok: false, error: 'no message' });
    const msg = `📞 ${shop.name} — note from Ann: ${note}`;
    const sent = await sendSms(shop.ownerCell, msg, 'office', 'trial_ann_note');
    try { if (crud) crud.logEvent('trial_ann_note', { shop: slug, sent, at_ms: Date.now() }); } catch (_) {}
    return json(200, { ok: sent, sent_to_owner: sent });
  }

  // capture_lead — the core: text the owner a clean, callable lead.
  // Automotive leads carry the vehicle; appliance leads carry the appliance.
  const isAuto = shop.type === 'automotive';
  const what = isAuto
    ? String(p.vehicle || p.summary || '').trim()
    : String(p.appliance || p.summary || '').trim();
  const detail = isAuto
    ? String(p.issue || p.problem || p.summary || '').trim()
    : String(p.problem || p.summary || '').trim();

  // PHONE→DATABASE BRIDGE: if this shop is on the platform, turn the lead into a real
  // JOB on their board + mint a customer portal link. Best-effort — a DB hiccup never
  // stops the owner SMS (the lead still lands on their phone).
  let board = { ok: false };
  if (shop.platformSlug && createLeadJob) {
    try {
      board = await createLeadJob({ slug: shop.platformSlug, name, phone, what, detail, city, source: 'ann_phone' });
    } catch (_) { board = { ok: false }; }
  }

  const lines = [
    `🔔 NEW LEAD — ${shop.name} (via Ann)`,
    name && `Name: ${name}`,
    phone && `Call back: ${fmtPhone(phone)}`,
    isAuto ? (what && `Vehicle: ${what}`) : (what && `Appliance: ${what}`),
    detail && `Needs: ${detail}`,
    city && `City: ${city}`,
    board.ok && board.portal_url ? `On your board ✅ · customer link: ${board.portal_url}` : null,
    `— Ann answered this for you. Call them back and close it. 🐜`,
  ].filter(Boolean);
  const msg = lines.join('\n');

  const sent = await sendSms(shop.ownerCell, msg, 'office', 'trial_ann_lead');

  // Text the CUSTOMER their intake link — the video/model-photo/availability/waiver bundle
  // (TN's intake magic). Only when the job made it onto the board (so the link is live).
  let customerTexted = false;
  if (phone && board.ok && board.intake_url) {
    const cmsg = `${shop.name}: thanks for calling! Tap here to send a quick video + a photo of the model sticker, pick your days, and sign a quick form so we show up ready to fix it: ${board.intake_url}`;
    try { customerTexted = await sendSms(phone, cmsg, 'customer', 'trial_ann_intake'); } catch (_) {}
  }

  try { if (crud) crud.logEvent('trial_ann_lead', { shop: slug, name, phone: phone.replace(/\D/g, '').slice(-10), what, sent, on_board: !!board.ok, job_id: board.job_id || '', customer_texted: customerTexted, at_ms: Date.now() }); } catch (_) {}
  return json(200, { ok: sent, sent_to_owner: sent, customer_texted: customerTexted, on_board: !!board.ok, job_id: board.job_id || null, intake_url: board.intake_url || null, portal_url: board.portal_url || null, reply: sent ? 'Lead sent to the shop and the customer got their intake link.' : 'Logged the lead.' });
};
