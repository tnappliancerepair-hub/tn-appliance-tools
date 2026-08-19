// amazon-asin-resolve — the ASIN last-mile for the Amazon drop-ship auto-placer.
// Amazon orders by ASIN, but a diagnosed parts order only carries a part NUMBER, and
// Amazon blocks server-side catalog search (datacenter IPs get an anti-bot shell), so
// there's no reliable cloud-only part#->ASIN lookup. This gives the office a 10-second
// assist instead: it lists every Amazon order waiting on an ASIN with a ready-made
// Amazon search link, and lets you paste the ASIN back onto the order — which the
// auto-placer then ships automatically on its next run.
//   GET  ?secret=&list=1                     -> orders needing an ASIN (+ search links)
//   POST ?secret=  {order_id, asin}          -> store the ASIN on that order
//   (GET ?secret=&order_id=&asin= also works for a quick manual set)
// Full hands-off resolution (no human) rides the Mac parts daemon's logged-in Amazon
// browser — a Mac-side follow-on, since a server can't reliably read Amazon's catalog.
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const PARTS_ORDERS = 47;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
function parseNotes(n) { try { return typeof n === 'string' ? JSON.parse(n) : (n || {}); } catch (_) { return {}; } }
const isAsin = (s) => /^[A-Z0-9]{10}$/i.test(String(s || '').trim());

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = (event && event.queryStringParameters) || {};
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const secret = q.secret || b.secret;
  if (secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const orderId = parseInt(String(q.order_id || b.order_id || '').replace(/\D/g, ''), 10) || 0;
  const asin = String(q.asin || b.asin || '').trim().toUpperCase();

  // --- SET an ASIN on an order ---
  if (orderId && asin) {
    if (!isAsin(asin)) return json(400, { ok: false, error: 'that does not look like an ASIN (10 letters/digits, e.g. B0XXXXXXXX)' });
    let row = {}; try { row = await crud.searchOne(PARTS_ORDERS, { id: orderId }) || {}; } catch (_) {}
    if (!row.id) return json(404, { ok: false, error: 'order not found' });
    const notes = parseNotes(row.notes); notes.asin = asin;
    try { await crud.update(PARTS_ORDERS, orderId, { notes: JSON.stringify(notes) }); } catch (e) { return json(200, { ok: false, error: 'save failed' }); }
    try { await crud.logEvent('amazon_asin_set', { order_id: orderId, asin, part: row.part_number || '', at_ms: Date.now() }); } catch (_) {}
    return json(200, { ok: true, order_id: orderId, asin, note: 'saved — the auto-placer will ship this on its next run once Amazon is live.' });
  }

  // --- LIST orders needing an ASIN ---
  let rows = [];
  try { rows = await crud.searchPage(PARTS_ORDERS, { order_status: 'to_order' }, { id: 'desc' }, 100); } catch (e) { return json(200, { ok: false, error: 'query failed' }); }
  const waiting = (rows || []).filter((r) => {
    const n = parseNotes(r.notes);
    return String(r.supplier || '').toLowerCase() === 'amazon' && String(n.ship_to || '').toLowerCase() === 'customer' && !(r.asin || n.asin);
  }).map((r) => {
    const part = String(r.part_number || '').trim();
    return {
      order_id: r.id, job_id: Number(r.job_id || 0), part, quantity: Number(r.quantity || 1),
      search_url: part ? `https://www.amazon.com/s?k=${encodeURIComponent(part)}` : '',
      set_example: `?secret=…&order_id=${r.id}&asin=B0XXXXXXXX`,
    };
  });
  return json(200, { ok: true, needing_asin: waiting.length, orders: waiting });
};
