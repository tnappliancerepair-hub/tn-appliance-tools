// Signal in: TRUCK_INVENTORY_RECONCILE
// Fires weekly (Sun 9-10am CT). Reads the parts_orders table grouped by
// tech_id, looks at:
//   - Parts ordered with delivered_at but no matching "installed"
//     row (still on truck)
//   - Parts ordered repeatedly by tech A while tech B has same SKU
//     sitting unused (redistribution opportunity)
//   - Per-tech turn rate: parts received this month vs installed this month
//
// Reads from parts_orders (created today). Until tech-ant-chat parts-
// order action populates rows, the agent reports 'insufficient_data'.

import { config } from '../config.js';

const INTAKE = (path) => `${config.xanoIntakeBase}${path}`;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  let analysis;
  try {
    const r = await fetch(INTAKE('/get_parts_cost_analysis?days_back=60'));
    analysis = await r.json();
  } catch (err) {
    await xano.markSignalProcessed(signal.id, 'truck_inventory_handled', { outcome: 'fetch_failed', error: String(err.message || err) });
    return { success: false, action: 'fetch_failed' };
  }

  const orders = (analysis && analysis.orders) || [];
  if (orders.length < 10) {
    const meta = {
      outcome: 'insufficient_data',
      orders_60d: orders.length,
      note: 'parts_orders is new — needs tech-ant-chat parts-order action + parts-vendor-gmail-poller wiring before reconciliation is meaningful',
    };
    await xano.markSignalProcessed(signal.id, 'truck_inventory_handled', meta);
    log('truck_inventory_insufficient_data', meta);
    return { success: true, action: 'insufficient_data' };
  }

  // Per-tech inventory: parts delivered but not marked installed
  const byTech = {};
  for (const o of orders) {
    const tid = String(o.tech_id || 0);
    if (!byTech[tid]) byTech[tid] = { onTruck: [], turnover: 0 };
    const status = (o.order_status || '').toLowerCase();
    if (status === 'delivered' || status === 'shipped') {
      byTech[tid].onTruck.push(o);
    }
    if (status === 'installed') byTech[tid].turnover += 1;
  }

  // Cross-tech SKU overlap (one has it sitting, another is ordering it)
  const skuByTech = {};
  for (const o of orders) {
    const pn = (o.part_number || '').toUpperCase();
    if (!pn) continue;
    const status = (o.order_status || '').toLowerCase();
    if (!skuByTech[pn]) skuByTech[pn] = { sittingWith: new Set(), neededBy: new Set() };
    if (status === 'delivered') skuByTech[pn].sittingWith.add(String(o.tech_id || 0));
    if (status === 'ordered')   skuByTech[pn].neededBy.add(String(o.tech_id || 0));
  }
  const redistributions = [];
  for (const [pn, m] of Object.entries(skuByTech)) {
    for (const recip of m.neededBy) {
      for (const owner of m.sittingWith) {
        if (recip !== owner) redistributions.push({ part_number: pn, from_tech: owner, to_tech: recip });
      }
    }
  }

  const hoarders = Object.entries(byTech)
    .map(([t, m]) => ({ tech_id: t, on_truck_count: m.onTruck.length, turnover: m.turnover }))
    .filter((t) => t.on_truck_count > 10 && t.turnover < 3)
    .sort((a, b) => b.on_truck_count - a.on_truck_count);

  let body = `[ant] truck inventory: ${orders.length} orders in 60d. `;
  if (redistributions.length > 0) body += `${redistributions.length} redistribution opportunities. `;
  if (hoarders.length > 0) body += `Possible hoarding: ${hoarders.slice(0, 2).map((h) => `tech ${h.tech_id} (${h.on_truck_count} on truck, ${h.turnover} installed)`).join(', ')}.`;
  if (redistributions.length === 0 && hoarders.length === 0) body += 'No issues flagged.';

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, {
        action: 'truck_inventory_digest',
        redistribution_count: redistributions.length,
        hoarder_count: hoarders.length,
      });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (e) {
      smsResult = String(e.message || e);
    }
  }

  const meta = {
    outcome: 'digest_sent',
    redistributions,
    hoarders,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'truck_inventory_handled', meta);
  log('truck_inventory_handled', meta);
  return { success: true, action: 'truck_inventory_handled' };
}
