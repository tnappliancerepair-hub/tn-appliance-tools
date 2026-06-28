// repair-quote — the flat-rate menu engine for the Teddy Tool / drawer.
//   ?menu=1                         -> the whole price-book (grouped, for the picker)
//   ?repair=fridge_ice_maker        -> flat labor + the repair's common parts (no live price)
//   ?repair=fridge_ice_maker&part=W10873791  -> flat labor + LIVE Marcone cost(÷.75) + all-in total
//   ?part=W10873791                 -> just price a part (cost ÷ .75)
//   add &warranty=1 to bill the part at cost (vendor-supplied warranty parts)
'use strict';

const { REPAIRS, SERVICE_CALL, NAT_AVG, byKey, sellPrice } = require('./_lib/repair-menu');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
const SITE = (process.env.URL || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }

// live Marcone cost via the existing marcone-lookup function (reuses the proven mSupply path)
async function marcone(partNumbers) {
  try {
    const r = await fetch(`${SITE}/.netlify/functions/marcone-lookup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ part_numbers: partNumbers }), signal: AbortSignal.timeout(30000),
    });
    const d = await r.json().catch(() => ({}));
    return (d && d.results) || [];
  } catch (_) { return []; }
}

function pricePart(res, warranty) {
  if (!res || !res.found) return { part_number: res ? res.part_number : '', found: false };
  const sell = sellPrice(res.cost, { warranty });
  return { part_number: res.part_number, found: true, description: res.description, make: res.make, cost: res.cost, sell, in_stock: res.in_stock, total_qty: res.total_qty, eta_days: res.eta_days };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  const warranty = q.warranty === '1' || q.warranty === 'true';

  // whole menu (grouped by appliance) for the picker
  if (q.menu) {
    const groups = {};
    for (const r of REPAIRS) { (groups[r.appliance] = groups[r.appliance] || []).push({ key: r.key, label: r.label, flat_labor: r.flat_labor, confirm: !!r.confirm, common_parts: r.common_parts, national_avg: NAT_AVG[r.key] || null }); }
    return j(200, { ok: true, service_call: SERVICE_CALL, groups });
  }

  // price a bare part
  if (q.part && !q.repair) {
    const [res] = await marcone([q.part]);
    return j(200, { ok: true, part: pricePart(res || { part_number: q.part, found: false }, warranty) });
  }

  // a repair quote
  if (q.repair) {
    const r = byKey(q.repair);
    if (!r) return j(404, { ok: false, error: 'unknown repair key' });
    const nat = NAT_AVG[r.key] || null;
    const out = { ok: true, repair: r.key, label: r.label, appliance: r.appliance, flat_labor: r.flat_labor, confirm: !!r.confirm, common_parts: r.common_parts, national_avg: nat };
    const partNum = q.part || (r.common_parts && r.common_parts[0]);
    if (partNum) {
      const [res] = await marcone([partNum]);
      const part = pricePart(res || { part_number: partNum, found: false }, warranty);
      out.part = part;
      out.total = part.found ? Math.round((r.flat_labor + part.sell) * 100) / 100 : null;
      out.breakdown = part.found ? `$${r.flat_labor} labor + $${part.sell} part = $${out.total}` : `$${r.flat_labor} labor + part (lookup failed — enter part #)`;
      // value-proof vs national average (only when we beat it — honest framing)
      if (out.total != null && nat) {
        const save = Math.round((nat - out.total) * 100) / 100;
        out.savings_vs_national = save;
        out.savings_pct = save > 0 ? Math.round((save / nat) * 100) : 0;
        out.value_note = save >= 5
          ? `National avg ~$${nat} → customer saves ~$${save} (${out.savings_pct}%) with us`
          : `Includes premium OEM part — still fair vs the ~$${nat} national average`;
      }
      // 💰 Amazon-equivalent BUDGET tier — SAME flat labor, different part.
      // When the Amazon Business API is live, pass the REAL cost via ?amazon_cost=
      // → real price + margin (cost ÷ .75), estimated:false. Until then, estimate
      // from OEM cost (aftermarket ≈ 60%), clearly flagged. The labor never changes.
      if (part.found && part.cost > 0) {
        const realAmzCost = q.amazon_cost != null && q.amazon_cost !== '' ? Number(q.amazon_cost) : null;
        const isReal = realAmzCost != null && !isNaN(realAmzCost) && realAmzCost > 0;
        const amzCost = isReal ? Math.round(realAmzCost * 100) / 100 : Math.round(part.cost * 0.6 * 100) / 100; // 0.6 = aftermarket estimate ratio (placeholder until API)
        const amzSell = sellPrice(amzCost, { warranty }); // same cost÷.75 margin rule
        const amzTotal = Math.round((r.flat_labor + amzSell) * 100) / 100; // SAME flat labor
        const amzSave = nat ? Math.round((nat - amzTotal) * 100) / 100 : null;
        const tag = isReal ? '' : ' est';
        out.amazon_est = {
          estimated: !isReal, source: isReal ? 'amazon_api' : 'estimate_0.6x_oem',
          part_cost: amzCost, sell: amzSell, total: amzTotal,
          savings_vs_national: amzSave,
          savings_pct: (nat && amzSave > 0) ? Math.round((amzSave / nat) * 100) : 0,
          note: `Budget (Amazon-equivalent) ~$${amzTotal}${tag}${(nat && amzSave > 0) ? ` — saves ~$${amzSave} (${Math.round((amzSave / nat) * 100)}%) vs national` : ''}.${isReal ? '' : ' Confirm exact part with Auto-find.'}`,
        };
      }
    } else {
      out.note = 'no part on file — enter the part # to get the all-in total';
    }
    return j(200, out);
  }

  return j(400, { ok: false, error: 'pass ?menu=1, ?repair=KEY[&part=#], or ?part=#' });
};
