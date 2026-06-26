// parts-markup-analysis — reverse-engineers the shop's REAL parts markup from
// historical parts_orders (cost vs sold), bucketed by cost band, so we can set a
// data-grounded standard instead of guessing. Also reports data-capture quality
// (how many parts even have cost+sold recorded) — that gap is itself a finding.
//   GET ?secret=<admin>
'use strict';
const { getSecret } = require('./_lib/secrets');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const PARTS_ORDERS = 47;
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function authH() { return { Authorization: 'Bearer ' + process.env.XANO_METADATA_TOKEN, 'Content-Type': 'application/json' }; }

const BANDS = [
  { label: '$0-25', lo: 0, hi: 25 },
  { label: '$25-75', lo: 25, hi: 75 },
  { label: '$75-150', lo: 75, hi: 150 },
  { label: '$150-400', lo: 150, hi: 400 },
  { label: '$400+', lo: 400, hi: 1e9 },
];
function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (!process.env.XANO_METADATA_TOKEN) return json(500, { ok: false, error: 'no metadata token' });

  // pull all parts_orders
  let rows = [];
  for (let page = 1; page <= 12; page++) {
    let r;
    try { r = await fetch(`${META}/table/${PARTS_ORDERS}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: 200, page, sort: { id: 'desc' } }) }); } catch (_) { break; }
    if (!r.ok) break;
    const d = await r.json().catch(() => ({}));
    const items = (d && d.items) || [];
    rows = rows.concat(items);
    if (items.length < 200) break;
  }

  const total = rows.length;
  let hasCost = 0, hasSold = 0, hasBoth = 0;
  const bySupplier = {};
  const usable = [];
  for (const r of rows) {
    const cost = (parseInt(r.cost_cents, 10) || 0) / 100;
    const sold = (parseInt(r.sold_to_customer_cents, 10) || 0) / 100;
    const sup = String(r.supplier || 'unknown').toLowerCase();
    bySupplier[sup] = bySupplier[sup] || { count: 0, with_both: 0 };
    bySupplier[sup].count++;
    if (cost > 0) hasCost++;
    if (sold > 0) hasSold++;
    if (cost > 0 && sold > 0) { hasBoth++; bySupplier[sup].with_both++; usable.push({ cost, sold, markup: sold / cost, margin: sold - cost, part: r.part_number, sup, appl: r.appliance_type }); }
  }

  // band stats from usable rows
  const bands = BANDS.map((b) => {
    const inB = usable.filter((u) => u.cost >= b.lo && u.cost < b.hi);
    const markups = inB.map((u) => u.markup);
    const margins = inB.map((u) => u.margin);
    return {
      band: b.label, count: inB.length,
      avg_markup_x: inB.length ? Number((markups.reduce((a, c) => a + c, 0) / inB.length).toFixed(2)) : null,
      median_markup_x: inB.length ? Number(median(markups).toFixed(2)) : null,
      avg_margin_$: inB.length ? Number((margins.reduce((a, c) => a + c, 0) / inB.length).toFixed(2)) : null,
      avg_cost_$: inB.length ? Number((inB.reduce((a, c) => a + c.cost, 0) / inB.length).toFixed(2)) : null,
    };
  });

  const allMarkups = usable.map((u) => u.markup);
  return json(200, {
    ok: true,
    data_quality: { total_parts_rows: total, have_cost: hasCost, have_sold: hasSold, have_BOTH_usable: hasBoth, pct_usable: total ? Math.round(100 * hasBoth / total) : 0 },
    overall: hasBoth ? {
      avg_markup_x: Number((allMarkups.reduce((a, c) => a + c, 0) / hasBoth).toFixed(2)),
      median_markup_x: Number(median(allMarkups).toFixed(2)),
      total_cost_$: Number(usable.reduce((a, c) => a + c.cost, 0).toFixed(2)),
      total_sold_$: Number(usable.reduce((a, c) => a + c.sold, 0).toFixed(2)),
      total_margin_$: Number(usable.reduce((a, c) => a + c.margin, 0).toFixed(2)),
    } : null,
    by_cost_band: bands,
    by_supplier: bySupplier,
    sample: usable.slice(0, 12).map((u) => ({ part: u.part, appl: u.appl, sup: u.sup, cost: Number(u.cost.toFixed(2)), sold: Number(u.sold.toFixed(2)), markup_x: Number(u.markup.toFixed(2)) })),
  });
};
