// list-customer-texts — the reliable feed behind the office Messages page.
//
// WHY THIS EXISTS (Teddy 2026-07-24, Danielle's "my texts are gone for the day / they
// reset at night"): the XS `list_sms_conversations` read the 300 NEWEST event_log rows
// in ONE query that INCLUDED every internal `sms_sent` (owner alerts, tech texts, all the
// automated customer texts). As the day's SMS volume piled up, that single 300-row window
// filled with recent/internal noise and the morning's CUSTOMER threads fell off the end —
// so they vanished from her view and never came back. Same read-cap class as the
// invoice/warranty-parts bugs.
//
// THE FIX: query each CUSTOMER-facing action in its OWN window, so internal `sms_sent`
// volume can never crowd out inbound customer texts (they live in a different action
// bucket). Retention widened to 30 days by default so she keeps a real reference. Returns
// the exact same row shape the page already parses: { id, action, created_at, metadata }.
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const EVENT_LOG = crud.TABLES.event_log;

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) }; }

// created_at comes back as epoch ms; guard the odd seconds-valued row.
function toMs(v) { const n = Number(v) || 0; return n > 0 && n < 1e12 ? n * 1000 : n; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

// Customer-facing inbound/reply actions are ALWAYS the customer's side — each gets its own
// clean window so nothing internal can evict them. `sms_sent` is mixed (internal + a few
// customer-facing) so it's pulled separately and filtered to non-internal.
const PURE_CUSTOMER = ['inbound_customer_sms_received', 'customer_sms_reply', 'dropped_customer_sms', 'feedback_sms_sent'];

async function rows(action, n) {
  try { return (await crud.searchPage(EVENT_LOG, { action }, { id: 'desc' }, Math.min(n || 500, 500))) || []; }
  catch (_) { return []; }
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const days = Math.max(1, Math.min(90, parseInt(q.days_back, 10) || 30));
  const cutoff = Date.now() - days * 86400000;

  // Pull each customer action's own window + the sms_sent window, in parallel.
  const [inbound, reply, dropped, feedback, sent] = await Promise.all([
    rows('inbound_customer_sms_received'), rows('customer_sms_reply'),
    rows('dropped_customer_sms'), rows('feedback_sms_sent'), rows('sms_sent'),
  ]);

  const out = [];
  const push = (r) => { out.push({ id: r.id, action: r.action || '', created_at: r.created_at, metadata: r.metadata }); };

  for (const r of [...inbound, ...reply, ...dropped, ...feedback]) {
    if (toMs(r.created_at) >= cutoff) push(r);
  }
  // sms_sent: keep only the customer-facing ones (drop internal owner/tech alerts).
  for (const r of sent) {
    if (toMs(r.created_at) < cutoff) continue;
    if ((metaOf(r).recipient_class || '') === 'internal') continue;
    push(r);
  }

  out.sort((a, b) => toMs(b.created_at) - toMs(a.created_at));
  return json(200, { success: true, count: out.length, days_back: days, rows: out });
};
