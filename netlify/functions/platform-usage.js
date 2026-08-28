// platform-usage — per-client usage tracking API. Server-side record + guardrail for the send/call
// paths (as tenants go live), and the OPERATOR summary: cost + margin per client, plus cap status.
// The internal meter (never a scary customer-facing meter) that answers "which shop is profitable"
// and "is anyone about to run away". Owner-gated.
//   POST ?action=record    {company_id, kind, qty, source?, cost_cents?, meta?}
//   GET  ?action=guardrail  &company_id=&kind=&qty=
//   GET  ?action=summary    -> per-client rollup + margin (this month)
//   GET/POST ?action=plan   get or upsert a client's plan
'use strict';
const { getSecret } = require('./_lib/secrets');
const meter = require('./_lib/usage-meter');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function monthStart() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); }

async function db() {
  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { base, H: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  const action = String(q.action || 'summary');
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  if (action === 'record') {
    const p = Object.assign({}, body, q);
    if (!p.company_id || !p.kind) return json(400, { ok: false, error: 'company_id + kind required' });
    const ok = await meter.record(p.company_id, p.kind, p.qty, { source: p.source, costCents: p.cost_cents, meta: p.meta });
    return json(200, { ok });
  }

  if (action === 'guardrail') {
    if (!q.company_id || !q.kind) return json(400, { ok: false, error: 'company_id + kind required' });
    const g = await meter.guardrail(q.company_id, q.kind, q.qty || 1);
    return json(200, { ok: true, ...g });
  }

  if (action === 'plan') {
    const { base, H } = await db();
    if (event.httpMethod === 'POST') {
      if (!body.company_id) return json(400, { ok: false, error: 'company_id required' });
      const row = { company_id: body.company_id, updated_at: new Date().toISOString() };
      ['tier', 'base_price_cents', 'included_voice_min', 'included_sms', 'voice_overage_cents', 'sms_overage_cents', 'cap_sms_per_hour', 'cap_sms_per_day', 'cap_voice_min_per_day', 'hard_stop'].forEach((k) => { if (body[k] != null) row[k] = body[k]; });
      const r = await fetch(`${base}/rest/v1/client_plan?on_conflict=company_id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(9000) });
      return json(200, { ok: r.ok });
    }
    return json(200, { ok: true, plan: await meter.getPlan(q.company_id) });
  }

  if (action === 'summary') {
    const { base, H } = await db();
    const from = monthStart(), to = new Date().toISOString();
    // real shops only (skip test/demo)
    const cr = await fetch(`${base}/rest/v1/company?select=id,name,slug,status&status=neq.test&order=name`, { headers: H, signal: AbortSignal.timeout(9000) });
    const companies = cr.ok ? (await cr.json().catch(() => [])) : [];
    const rows = [];
    for (const c of companies) {
      const [roll, plan] = await Promise.all([meter.rollup(c.id, from, to), meter.getPlan(c.id)]);
      const voiceMin = Math.round(Number(roll.voice_min) || 0);
      const sms = Math.round(Number(roll.sms_out) || 0);
      const costCents = Math.round(Number(roll.cost_cents) || 0);
      const voiceOver = Math.max(0, voiceMin - plan.included_voice_min);
      const smsOver = Math.max(0, sms - plan.included_sms);
      const overageCents = voiceOver * plan.voice_overage_cents + smsOver * plan.sms_overage_cents;
      const revenueCents = plan.base_price_cents + overageCents;
      rows.push({
        company: c.name, slug: c.slug, tier: plan.tier,
        voice_min: voiceMin, sms_out: sms,
        voice_pct: plan.included_voice_min ? Math.round(voiceMin / plan.included_voice_min * 100) : 0,
        sms_pct: plan.included_sms ? Math.round(sms / plan.included_sms * 100) : 0,
        cost: +(costCents / 100).toFixed(2),
        base_price: +(plan.base_price_cents / 100).toFixed(2),
        overage: +(overageCents / 100).toFixed(2),
        revenue: +(revenueCents / 100).toFixed(2),
        margin: +((revenueCents - costCents) / 100).toFixed(2),
        near_cap: voiceMin > plan.cap_voice_min_per_day * 0.8 || sms > plan.cap_sms_per_day * 0.8,
        default_plan: !!plan._default,
      });
    }
    const totals = rows.reduce((t, r) => ({ cost: t.cost + r.cost, revenue: t.revenue + r.revenue, margin: t.margin + r.margin }), { cost: 0, revenue: 0, margin: 0 });
    return json(200, { ok: true, period: from.slice(0, 7), clients: rows, totals: { cost: +totals.cost.toFixed(2), revenue: +totals.revenue.toFixed(2), margin: +totals.margin.toFixed(2) } });
  }

  return json(400, { ok: false, error: 'unknown action' });
};
