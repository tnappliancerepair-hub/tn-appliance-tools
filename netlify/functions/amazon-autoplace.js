// amazon-autoplace — closes the Amazon drop-ship loop: a paid customer's DIY part
// auto-ships from Amazon Business with no human. Mirrors parts-autoplace (the Marcone
// placer) for the Amazon supplier branch. Watches parts_orders for PAID + ship-to-
// customer + Amazon + not-yet-placed rows that carry an ASIN, and fires
// amazon-business-order for each. Amazon orders by ASIN (not a part number), so a row
// needs one on it (notes.asin / an asin column). Rows without an ASIN are reported as
// needs_asin — the part#->ASIN resolver is the follow-on piece, and until it exists the
// office can drop an ASIN on the row and this places it on the next run.
//
// SAFETY — real money, DOUBLE-GATED:
//   • SHADOW by default: logs what it WOULD order, places NOTHING, calls nothing.
//   • Goes live ONLY when BOTH  vault AMAZON_AUTOPLACE_LIVE=true  AND the connector is in
//     production (AMAZON_BUSINESS_ENV=production + fully configured). In sandbox a "live"
//     run still can't buy anything — the connector refuses a real order outside production.
//   • Idempotent: amazon-business-order marks the row ordered, so it's never double-placed.
//   • Kill switch: AMAZON_AUTOPLACE=false.   Inspect: ?dryrun=1  (with ?secret=).
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const amazon = require('./_lib/amazon-business');

const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const PARTS_ORDERS = 47;
const OWNER = '+16154855795';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function parseNotes(n) { try { return typeof n === 'string' ? JSON.parse(n) : (n || {}); } catch (_) { return {}; } }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dry = q.dryrun === '1';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  // scheduled cron self-authorizes ({next_run}); manual/wrapper calls need ?secret=
  let scheduled = false; try { scheduled = !!JSON.parse((event && event.body) || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  if (String(await getSecret('AMAZON_AUTOPLACE') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });

  // LIVE requires BOTH the explicit flag AND the connector actually being in production.
  const flagLive = String(await getSecret('AMAZON_AUTOPLACE_LIVE') || '').toLowerCase() === 'true';
  let creds = {}; try { creds = await amazon.creds(); } catch (_) {}
  const production = String(creds.env || 'sandbox').toLowerCase() === 'production' && amazon.isConfigured(creds);
  const live = flagLive && production && !dry;

  // 1. candidate rows: to_order, supplier amazon, ship-to-customer
  let rows = [];
  try { rows = await crud.searchPage(PARTS_ORDERS, { order_status: 'to_order' }, { id: 'desc' }, 100); } catch (e) { return json(200, { ok: false, error: 'query failed' }); }
  const candidates = (rows || []).filter((r) => {
    const n = parseNotes(r.notes);
    return String(r.supplier || '').toLowerCase() === 'amazon' && String(n.ship_to || '').toLowerCase() === 'customer';
  });

  const placed = [], skipped = [], shadow = [], needsAsin = [];
  for (const r of candidates) {
    const n = parseNotes(r.notes);
    const asin = String(r.asin || n.asin || '').trim();
    const planned = { order_id: r.id, job_id: Number(r.job_id || 0), asin, part: String(r.part_number || '').trim(), qty: Number(r.quantity || 1) };
    if (!asin) { needsAsin.push({ order_id: r.id, job_id: planned.job_id, part: planned.part }); continue; }

    if (!live) { shadow.push(planned); continue; }

    // LIVE place — amazon-business-order resolves the ship address, places, marks the row + logs.
    let res;
    try {
      res = await fetch(`${BASE}/amazon-business-order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: r.id, asin, quantity: planned.qty, live: true }),
        signal: AbortSignal.timeout(25000),
      }).then((x) => x.json());
    } catch (e) { skipped.push({ order_id: r.id, why: 'place error: ' + String((e && e.message) || e) }); continue; }
    if (res && res.ok) {
      try { await crud.logEvent('amazon_autoplaced', { ...planned, amazon_order_id: res.amazon_order_id || '', at_ms: Date.now() }); } catch (_) {}
      placed.push({ ...planned, amazon_order_id: res.amazon_order_id || '' });
    } else if (res && res.configured === false) {
      skipped.push({ order_id: r.id, why: 'amazon not enrolled/production yet' });
    } else {
      skipped.push({ order_id: r.id, why: 'amazon declined: ' + ((res && res.error) || 'unknown') });
    }
  }

  if (live && placed.length) {
    const body = `[ant] 📦 Auto-shipped ${placed.length} customer part(s) from Amazon:\n` +
      placed.slice(0, 8).map((p) => `  • ${p.part || p.asin} (qty ${p.qty}) — order ${p.amazon_order_id || 'placed'}`).join('\n');
    try { await sendSms(OWNER, body, 'owner', 'amazon_autoplace'); } catch (_) {}
  }

  return json(200, {
    ok: true,
    mode: dry ? 'dryrun' : (live ? 'live' : 'shadow'),
    env: creds.env || 'sandbox',
    gate: { flag_live: flagLive, production, effective_live: live },
    candidates: candidates.length,
    placed: placed.length, shadow: shadow.length, needs_asin: needsAsin.length, skipped: skipped.length,
    placed_list: placed,
    shadow_list: shadow.slice(0, 10),
    needs_asin_list: needsAsin.slice(0, 10),
    skipped_list: skipped.slice(0, 6),
  });
};
