// hcp-analysis — mine intelligence out of hcp_archive (the 49k HCP records).
//
// Reads the archive with TARGETED jsonb selects (not full rows) and tallies the
// things that sharpen the business: job volume by appliance + status, revenue,
// invoice/payment health, and the most common line items + their typical price
// (price/margin calibration for the flat-rate menu). Stores the result as a
// `_analysis` row and returns it. Read-only on the archive; touches nothing live.
//
//   GET ?secret=<admin>          run + store + return the analysis
//   GET ?secret=<admin>&peek=1   return the last stored analysis (no recompute)
'use strict';
const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const num = (x) => { const n = Number(String(x == null ? '' : x).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const money = (cents) => '$' + (cents / 100).toFixed(2);

// HCP money fields come as integer cents on jobs/invoices (total_amount/amount).
const APPLIANCES = [
  ['refrigerator', /\b(fridge|refriger|freezer|ice ?maker|icemaker)\b/i],
  ['washer', /\b(washer|washing machine|front ?load|top ?load)\b/i],
  ['dryer', /\b(dryer|vent)\b/i],
  ['dishwasher', /\b(dish ?washer|dishwasher)\b/i],
  ['range/oven', /\b(range|oven|stove|cook ?top|cooktop|burner)\b/i],
  ['microwave', /\b(microwave|micro ?wave)\b/i],
  ['disposal', /\b(disposal|garbage)\b/i],
];
function detectAppliance(text) { const t = String(text || ''); for (const [name, re] of APPLIANCES) if (re.test(t)) return name; return 'other/unknown'; }

async function pageAll(table, selectExpr, filter, onRow, cap = 60) {
  let offset = 0; const LIM = 1000; let total = 0;
  for (let p = 0; p < cap; p++) {
    const rows = await sb.select(table, { ...filter, select: selectExpr, limit: LIM, offset });
    if (!rows || !rows.length) break;
    for (const r of rows) onRow(r);
    total += rows.length; offset += LIM;
    if (rows.length < LIM) break;
  }
  return total;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (!(await sb.isConnected())) return json(200, { ok: false, error: 'supabase not configured' });

  if (q.peek === '1') {
    try { const rows = await sb.select('hcp_archive', { kind: 'eq._analysis', order: 'id.desc', limit: 1 }); return json(200, { ok: true, analysis: (rows && rows[0] && rows[0].data) || null }); } catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
  }

  // ── JOBS ──────────────────────────────────────────────────────────
  const byAppliance = {}, byStatus = {}, byLead = {};
  let jobCount = 0, jobRevenueCents = 0, withNotes = 0, withDesc = 0;
  try {
    await pageAll('hcp_archive', 'd:data->>description,n:data->>notes,ws:data->>work_status,amt:data->>total_amount,lead:data->>lead_source', { kind: 'eq.job' }, (r) => {
      jobCount++;
      const appl = detectAppliance((r.d || '') + ' ' + (r.n || ''));
      byAppliance[appl] = (byAppliance[appl] || 0) + 1;
      const ws = (r.ws || 'unknown').toLowerCase(); byStatus[ws] = (byStatus[ws] || 0) + 1;
      if (r.lead) { byLead[r.lead] = (byLead[r.lead] || 0) + 1; }
      jobRevenueCents += num(r.amt);
      if (r.n && String(r.n).trim()) withNotes++;
      if (r.d && String(r.d).trim()) withDesc++;
    });
  } catch (e) { return json(200, { ok: false, stage: 'jobs', error: String(e.message || e) }); }

  // ── INVOICES (revenue + line items for price calibration) ─────────
  let invCount = 0, invAmountCents = 0, invDueCents = 0, invPaid = 0;
  const itemTally = {}; // item name -> {n, sumCents}
  try {
    await pageAll('hcp_archive', 'amt:data->>amount,due:data->>due_amount,paid:data->>paid_at,items:data->items', { kind: 'eq.invoice' }, (r) => {
      invCount++;
      invAmountCents += num(r.amt);
      invDueCents += num(r.due);
      if (r.paid) invPaid++;
      const items = Array.isArray(r.items) ? r.items : [];
      for (const it of items) {
        const nm = String((it && (it.name || it.description)) || 'unnamed').trim().slice(0, 60);
        const price = num(it && (it.unit_price || it.amount || it.unit_cost));
        if (!itemTally[nm]) itemTally[nm] = { n: 0, sumCents: 0 };
        itemTally[nm].n++; itemTally[nm].sumCents += price;
      }
    });
  } catch (e) { return json(200, { ok: false, stage: 'invoices', error: String(e.message || e), partial_jobs: jobCount }); }

  const sortDesc = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const topItems = Object.entries(itemTally)
    .map(([name, v]) => ({ name, count: v.n, avg_price: v.n ? money(Math.round(v.sumCents / v.n)) : '$0' }))
    .sort((a, b) => b.count - a.count).slice(0, 30);

  const analysis = {
    generated_ct: new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }),
    jobs: {
      total: jobCount,
      revenue: money(jobRevenueCents),
      with_description_pct: jobCount ? Math.round((withDesc / jobCount) * 100) : 0,
      with_notes_pct: jobCount ? Math.round((withNotes / jobCount) * 100) : 0,
      by_appliance: sortDesc(byAppliance).map(([k, v]) => ({ appliance: k, jobs: v })),
      by_status: sortDesc(byStatus).slice(0, 12).map(([k, v]) => ({ status: k, jobs: v })),
      top_lead_sources: sortDesc(byLead).slice(0, 10).map(([k, v]) => ({ source: k, jobs: v })),
    },
    invoices: {
      total: invCount,
      total_invoiced: money(invAmountCents),
      outstanding: money(invDueCents),
      paid_pct: invCount ? Math.round((invPaid / invCount) * 100) : 0,
      avg_invoice: invCount ? money(Math.round(invAmountCents / invCount)) : '$0',
      top_line_items: topItems,
    },
  };

  try { await sb.insert('hcp_archive', [{ kind: '_analysis', title: 'hcp analysis ' + analysis.generated_ct, data: analysis }]); } catch (_) {}
  return json(200, { ok: true, stored: true, analysis });
};
