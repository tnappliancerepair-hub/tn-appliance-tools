// Signal in: PARTS_COST_OPTIMIZER
// Fires weekly (Sun 9-10am CT) via tick.js. Reads parts_orders for the
// last 30 days, groups by part_number across suppliers, surfaces cost
// deltas where the same SKU is bought from 2+ vendors at different
// prices. SMSes Teddy a digest with potential savings.
//
// Data dependency: parts_orders rows. Until tech-ant-chat parts-order
// action / parts-vendor-gmail-poller / warranty_claim_action populate
// them, the agent will run cleanly but report 'insufficient data'.
//
// Uses Haiku tier (cheap classification + numeric aggregation, no
// composition needed).

import { config } from '../config.js';

const INTAKE = (path) => `${config.xanoIntakeBase}${path}`;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  let analysis;
  try {
    const r = await fetch(INTAKE('/get_parts_cost_analysis?days_back=30'));
    analysis = await r.json();
  } catch (err) {
    const meta = { outcome: 'fetch_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'parts_cost_optimizer_handled', meta);
    log('parts_cost_optimizer_fetch_failed', meta);
    return { success: false, action: 'fetch_failed' };
  }

  const orders = (analysis && analysis.orders) || [];
  const totalOrders = Number(analysis?.total_orders || 0);
  const totalSpend  = Number(analysis?.total_spend_cents || 0);

  // Group by part_number → array of {supplier, cost_cents, ordered_at}
  const bySku = {};
  for (const o of orders) {
    const pn = (o.part_number || '').trim().toUpperCase();
    if (!pn) continue;
    if (!bySku[pn]) bySku[pn] = [];
    bySku[pn].push({
      supplier: (o.supplier || 'other').toLowerCase(),
      cost_cents: Number(o.cost_cents || 0),
      ordered_at: o.ordered_at,
    });
  }

  // Find SKUs with 2+ distinct suppliers
  const deltas = [];
  for (const [pn, rows] of Object.entries(bySku)) {
    const bySupplier = {};
    for (const r of rows) {
      if (!bySupplier[r.supplier]) bySupplier[r.supplier] = [];
      bySupplier[r.supplier].push(r.cost_cents);
    }
    const suppliers = Object.keys(bySupplier);
    if (suppliers.length < 2) continue;
    const supplierAvg = suppliers.map((s) => ({
      supplier: s,
      avg: bySupplier[s].reduce((a, b) => a + b, 0) / bySupplier[s].length,
      count: bySupplier[s].length,
    })).sort((a, b) => a.avg - b.avg);
    const cheapest = supplierAvg[0];
    const priciest = supplierAvg[supplierAvg.length - 1];
    if (priciest.avg <= cheapest.avg) continue;
    const delta = priciest.avg - cheapest.avg;
    const annualSavings = delta * Math.max(rows.length, 1) * (365 / 30); // crude extrapolation
    deltas.push({
      part_number: pn,
      cheapest_supplier: cheapest.supplier,
      cheapest_avg_cents: Math.round(cheapest.avg),
      priciest_supplier: priciest.supplier,
      priciest_avg_cents: Math.round(priciest.avg),
      delta_cents: Math.round(delta),
      orders_last_30d: rows.length,
      est_annual_savings_cents: Math.round(annualSavings),
    });
  }
  deltas.sort((a, b) => b.est_annual_savings_cents - a.est_annual_savings_cents);
  const topDeltas = deltas.slice(0, 5);

  // Insufficient-data branch — be honest about it.
  if (totalOrders < 10) {
    const meta = {
      outcome: 'insufficient_data',
      total_orders_30d: totalOrders,
      message: `${totalOrders} parts orders in last 30d — agent needs ≥10 (with ≥2 suppliers per SKU) before deltas are statistically meaningful`,
    };
    await xano.markSignalProcessed(signal.id, 'parts_cost_optimizer_handled', meta);
    log('parts_cost_optimizer_insufficient_data', meta);
    return { success: true, action: 'insufficient_data', total_orders_30d: totalOrders };
  }

  // Body composition (no Claude — straight format)
  const fmtMoney = (c) => '$' + (c / 100).toFixed(2);
  let body = `[ant] parts cost (last 30d): ${totalOrders} orders, ${fmtMoney(totalSpend)} spend. `;
  if (topDeltas.length === 0) {
    body += 'No cross-supplier deltas found yet — need 2+ suppliers per SKU.';
  } else {
    const topThree = topDeltas.slice(0, 3).map((d) =>
      `${d.part_number}: ${d.cheapest_supplier}=${fmtMoney(d.cheapest_avg_cents)} vs ${d.priciest_supplier}=${fmtMoney(d.priciest_avg_cents)} (annual save ~${fmtMoney(d.est_annual_savings_cents)})`
    ).join('; ');
    body += `Top savings opportunities: ${topThree}`;
  }

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, {
        action: 'parts_cost_optimizer_digest',
        total_orders_30d: totalOrders,
        total_spend_cents: totalSpend,
        delta_count: deltas.length,
      });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (err) {
      smsResult = String(err.message || err);
    }
  }

  const meta = {
    outcome: 'digest_sent',
    total_orders_30d: totalOrders,
    total_spend_cents: totalSpend,
    delta_count: deltas.length,
    top_deltas: topDeltas,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'parts_cost_optimizer_handled', meta);
  log('parts_cost_optimizer_handled', meta);
  return { success: true, action: 'parts_cost_optimizer_handled', delta_count: deltas.length };
}
