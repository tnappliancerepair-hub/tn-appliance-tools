// trial-ann-costs — per-shop unit economics for the Ann trials. Pulls each shop's REAL
// Telnyx usage (AI talk time + inbound minutes + lead SMS) attributed to its own Ann
// number/connection, adds the number rental, and compares to what we charge (planPrice)
// → cost / charge / margin per shop, plus a rollup. Because every shop has its own number
// and its own AI connection, every dollar is cleanly attributable.
//
//   ?secret=<vapi-admin>            -> rollup across all registered shops (30d)
//   ?secret=&shop=greg              -> just that shop
//   ?secret=&days=7                 -> window
//   ?secret=&debug=1                -> raw record types + a matched sample (to tune fields)
'use strict';

const { getSecret } = require('./_lib/secrets');
const shops = require('./_lib/trial-shops');
const TELNYX = 'https://api.telnyx.com/v2';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const NUMBER_RENTAL_MONTHLY = 1.0;   // ~$1/mo per Telnyx number
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 1) }; }
function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function digits(s) { return String(s || '').replace(/\D/g, ''); }

function recTime(x) {
  for (const k of ['created_at', 'started_at', 'sent_at', 'occurred_at', 'completed_at']) {
    if (x && x[k]) { const t = Date.parse(x[k]); if (!isNaN(t)) return t; }
  }
  return 0;
}
// Telnyx detail records carry cost under different keys per record type. Take the first real one.
function recCost(x) {
  for (const k of ['cost', 'total_cost', 'amount', 'billed_amount']) {
    const v = parseFloat(x && x[k]); if (!isNaN(v)) return v;
  }
  // some records give rate + a duration/units; last-resort estimate
  const rate = parseFloat(x && (x.rate || x.unit_price));
  const units = parseFloat(x && (x.billed_sec || x.duration_secs || x.parts));
  if (!isNaN(rate) && !isNaN(units)) return rate * (x.billed_sec || x.duration_secs ? units / 60 : units);
  return 0;
}
function recMins(x) {
  for (const k of ['billed_sec', 'duration_secs', 'duration_millis']) {
    const v = parseFloat(x && x[k]); if (!isNaN(v)) return k === 'duration_millis' ? v / 60000 : v / 60;
  }
  return 0;
}

async function pullRecords(H, sinceMs, maxPages) {
  let all = [];
  for (let p = 1; p <= (maxPages || 20); p++) {
    let d = {};
    try {
      const r = await fetch(`${TELNYX}/detail_records?page[size]=250&page[number]=${p}&sort=-created_at`, { headers: H, signal: AbortSignal.timeout(12000) });
      d = await r.json().catch(() => ({}));
    } catch (_) { break; }
    const rows = Array.isArray(d && d.data) ? d.data : [];
    if (!rows.length) break;
    all = all.concat(rows);
    const t = recTime(rows[rows.length - 1]);
    if (t && t < sinceMs) break;   // reached older than the window
  }
  return all.filter((x) => { const t = recTime(x); return !t || t >= sinceMs; });
}

// A record belongs to a shop if its own Ann number or Ann connection appears in it.
function matchesShop(recStr, shop) {
  const num = digits(shop.annNumber);
  if (num && recStr.includes(num)) return true;
  if (shop.annConnection && recStr.includes(shop.annConnection)) return true;
  return false;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return { statusCode: 403, body: 'forbidden' };
  const KEY = await getSecret('TELNYX_API_KEY');
  if (!KEY) return json(200, { ok: false, error: 'TELNYX_API_KEY not in vault' });
  const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  const days = Math.max(1, Math.min(90, parseInt(q.days, 10) || 30));
  const sinceMs = Date.now() - days * 86400000;

  // which shops
  const slugs = q.shop ? [String(q.shop).toLowerCase().trim()] : Object.keys(shops.SHOPS || {});
  const targets = slugs.map((s) => Object.assign({ slug: s }, shops.get(s))).filter((s) => s && s.name);
  if (!targets.length) return json(200, { ok: false, error: q.shop ? ('unknown shop: ' + q.shop) : 'no shops registered yet' });

  const records = await pullRecords(H, sinceMs, q.debug ? 4 : 20);

  if (q.debug === '1') {
    const byType = {}; records.forEach((x) => { const k = x.record_type || 'unknown'; byType[k] = (byType[k] || 0) + 1; });
    const sampleShop = targets.find((s) => s.annNumber) || targets[0];
    const matched = records.find((x) => matchesShop(JSON.stringify(x), sampleShop));
    return json(200, { ok: true, days, pulled: records.length, by_record_type: byType, matched_sample: matched || null, sample_shop: sampleShop.slug });
  }

  const rows = targets.map((shop) => {
    let aiCost = 0, mins = 0, hits = 0;
    if (shop.annNumber || shop.annConnection) {
      for (const x of records) {
        if (matchesShop(JSON.stringify(x), shop)) { aiCost += recCost(x); mins += recMins(x); hits++; }
      }
    }
    const rental = shop.annNumber ? NUMBER_RENTAL_MONTHLY * (days / 30) : 0;
    const cost = money(aiCost + rental);
    const charge = money(shop.planPrice || 0);
    return {
      shop: shop.name, slug: shop.slug, live: !!shop.annNumber,
      window_days: days,
      usage_events: hits, talk_minutes: money(mins),
      cost_usd: cost, of_which_usage: money(aiCost), of_which_number: money(rental),
      charge_usd: charge, margin_usd: money(charge - cost),
      margin_pct: charge > 0 ? Math.round(((charge - cost) / charge) * 100) : null,
    };
  });

  const totals = rows.reduce((a, r) => { a.cost += r.cost_usd; a.charge += r.charge_usd; return a; }, { cost: 0, charge: 0 });
  return json(200, {
    ok: true, window_days: days, shops: rows,
    rollup: { total_cost_usd: money(totals.cost), total_charge_usd: money(totals.charge), total_margin_usd: money(totals.charge - totals.cost) },
    note: 'Cost = real Telnyx usage attributed to each shop\'s own Ann number/connection + ~$1/mo number rental. Charge = planPrice in the registry (0 = free trial).',
  });
};
