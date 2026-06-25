// parts-autoplace — closes the self-checkout loop: a paid customer's DIY part auto-ships
// from Marcone with no human. Watches parts_orders for PAID + ship-to-customer + Marcone +
// not-yet-placed rows (the row only exists because Stripe payment completed) and fires
// marcone-order place for each. Routes AROUND the "TBD" bug: if part_number=="TBD", reads
// the linked job's tdr_failure.oem_part_number first.
//
// SAFETY: real money. SHADOW by default (logs what it WOULD order, places nothing). Go live
// = vault SELF_CHECKOUT_AUTOPLACE_LIVE=true. Idempotent (marks rows placed). Kill switch:
// SELF_CHECKOUT_AUTOPLACE=false. ?dryrun=1 inspects.
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const PARTS_ORDERS = 47;
const OWNER = '+16154855795';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function parseNotes(n) { try { return typeof n === 'string' ? JSON.parse(n) : (n || {}); } catch (_) { return {}; } }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  if (String(await getSecret('SELF_CHECKOUT_AUTOPLACE') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  const live = String(await getSecret('SELF_CHECKOUT_AUTOPLACE_LIVE') || '').toLowerCase() === 'true';
  const adminSecret = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';

  // 1. candidate rows: to_order, supplier marcone, ship-to-customer
  let rows = [];
  try { rows = await crud.searchPage(PARTS_ORDERS, { order_status: 'to_order' }, { id: 'desc' }, 100); } catch (e) { return json(200, { ok: false, error: 'query failed' }); }
  const candidates = (rows || []).filter((r) => {
    const sup = String(r.supplier || '').toLowerCase();
    const n = parseNotes(r.notes);
    return sup === 'marcone' && String(n.ship_to || '').toLowerCase() === 'customer';
  });

  const placed = [], skipped = [], shadow = [];
  for (const r of candidates) {
    const jobId = Number(r.job_id || 0);
    // resolve part# (route around the TBD bug via the job's TDR failure) + ship address
    let part = String(r.part_number || '').trim();
    let cust = {};
    if (jobId) {
      try {
        const ctx = await fetch(`${XANO}/get_warranty_submission_context?job_id=${jobId}`, { signal: AbortSignal.timeout(10000) }).then((x) => x.json());
        cust = (ctx && ctx.customer) || {};
        if (!part || part.toUpperCase() === 'TBD') {
          const f = ((ctx && ctx.tdr_failures) || []).find((x) => x.oem_part_number || x.verified_part_number);
          part = (f && (f.oem_part_number || f.verified_part_number)) || part;
        }
      } catch (_) {}
    }
    if (!part || part.toUpperCase() === 'TBD') { skipped.push({ order_id: r.id, why: 'no part number' }); continue; }
    const shipTo = { name: [cust.first_name, cust.last_name].filter(Boolean).join(' '), address1: cust.address_line1 || cust.address || '', city: cust.city || '', state: cust.state || '', zip: cust.zip || cust.zip_code || '', phone: String(cust.phone || '').replace(/\D/g, '') };
    const planned = { order_id: r.id, job_id: jobId, part, ship_to_city: shipTo.city, who: shipTo.name };

    if (!live || dry) { shadow.push(planned); continue; }
    if (!shipTo.address1) { skipped.push({ order_id: r.id, why: 'no ship address' }); continue; }
    // LIVE place
    let res;
    try {
      res = await fetch('https://tnapplianceexchange.net/.netlify/functions/marcone-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'place', secret: adminSecret, confirm: true, part_number: part, quantity: Number(r.quantity || 1), ship_to: shipTo }),
        signal: AbortSignal.timeout(25000),
      }).then((x) => x.json());
    } catch (e) { skipped.push({ order_id: r.id, why: 'place error: ' + String((e && e.message) || e) }); continue; }
    if (res && res.ok) {
      const orderRef = res.order_number || res.order_id || res.po || '';
      try { await crud.update(PARTS_ORDERS, r.id, { order_status: 'ordered', supplier: 'marcone', part_number: part, order_reference: String(orderRef), ordered_at: Date.now() }); } catch (_) {}
      try { await crud.logEvent('parts_autoplaced', { ...planned, order_reference: orderRef, at_ms: Date.now() }); } catch (_) {}
      placed.push({ ...planned, order_reference: orderRef });
    } else skipped.push({ order_id: r.id, why: 'marcone declined: ' + ((res && res.error) || 'unknown') });
  }

  if (!dry && placed.length) {
    const body = `[ant] 📦 Auto-shipped ${placed.length} customer part(s) from Marcone:\n` + placed.slice(0, 8).map((p) => `  • ${p.part} → ${p.who || 'customer'} ${p.ship_to_city} (order ${p.order_reference})`).join('\n');
    try { await sendSms(OWNER, body, 'owner', 'parts_autoplace'); } catch (_) {}
  }
  return json(200, { ok: true, mode: dry ? 'dryrun' : (live ? 'live' : 'shadow'), candidates: candidates.length, placed: placed.length, shadow: shadow.length, skipped: skipped.length, shadow_list: shadow.slice(0, 10), placed_list: placed, skipped: skipped.slice(0, 6) });
};
