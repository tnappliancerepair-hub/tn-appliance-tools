// hcp-lookup — look up a customer in the Housecall Pro archive by phone (or name) and
// return their history: who they are + past jobs + invoices. Answers "is this a real
// customer / why are they in our old system?"
//   GET ?secret=<admin>&phone=6153060832   (or &name=Mosakowski)
'use strict';
const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (!(await sb.isConnected())) return json(200, { ok: false, error: 'supabase not configured' });

  const p10 = String(q.phone || '').replace(/\D/g, '').slice(-10);
  let customers = [];
  try {
    if (p10) customers = await sb.select('hcp_archive', { kind: 'eq.customer', phone10: 'eq.' + p10, select: 'hcp_id,phone10,data', limit: 10 });
    if (!customers.length && q.name) customers = await sb.select('hcp_archive', { kind: 'eq.customer', 'data->>last_name': 'ilike.*' + String(q.name).trim() + '*', select: 'hcp_id,phone10,data', limit: 10 });
  } catch (e) { return json(200, { ok: false, error: 'customer query: ' + String(e.message || e) }); }

  if (!customers.length) return json(200, { ok: true, found: false, phone10: p10, note: 'no Housecall Pro customer with that phone/name in the archive' });

  const out = [];
  for (const cust of customers.slice(0, 5)) {
    const c = cust.data || {};
    const cid = cust.hcp_id;
    let jobs = [], invoices = [];
    try { jobs = await sb.select('hcp_archive', { kind: 'eq.job', cust_id: 'eq.' + cid, order: 'id.desc', limit: 25, select: 'data' }); } catch (_) {}
    try { invoices = await sb.select('hcp_archive', { kind: 'eq.invoice', cust_id: 'eq.' + cid, order: 'id.desc', limit: 25, select: 'data' }); } catch (_) {}
    const addr = c.address || (Array.isArray(c.addresses) && c.addresses[0]) || {};
    out.push({
      hcp_id: cid,
      name: [c.first_name, c.last_name].filter(Boolean).join(' '),
      company: c.company || '',
      phones: [c.mobile_number, c.home_number, c.work_number].filter(Boolean),
      email: c.email || '',
      address: [addr.street, addr.city, addr.state, addr.zip || addr.postal_code].filter(Boolean).join(', '),
      created: c.created_at || c.created || '',
      job_count: jobs.length,
      jobs: jobs.map((j) => { const d = j.data || {}; return { what: String(d.description || d.name || '').slice(0, 90), status: d.work_status, when: d.scheduled_start || d.created_at || '', total: d.total_amount, lead: d.lead_source }; }),
      invoice_count: invoices.length,
      invoices: invoices.map((i) => { const d = i.data || {}; return { amount: d.amount || d.total, paid_at: d.paid_at, due: d.due_amount }; }),
    });
  }
  return json(200, { ok: true, found: true, phone10: p10, matches: out.length, customers: out });
};
