// platform-ops — the OPERATOR view of the whole Ant platform (every tenant at once).
// A single shop's login is RLS-scoped to itself, so it can never see across tenants;
// this owner-gated endpoint runs one aggregate query with the mgmt token and returns
// platform-wide totals + a per-tenant row for each shop. Backs /platform/ops.html.
//
//   GET ?secret=<admin>   -> { ok, totals:{...}, tenants:[{...}] }
'use strict';
const { getSecret } = require('./_lib/secrets');
const MGMT = 'https://api.supabase.com/v1';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function refFromUrl(u) { const m = String(u || '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i); return m ? m[1] : ''; }
const n = (v) => { const x = parseInt(v, 10); return isNaN(x) ? 0 : x; };

const SQL = `
select
  c.id, c.name, c.slug, c.trade, c.plan, c.created_at,
  (select count(*) from job j where j.company_id=c.id) jobs,
  (select count(*) from job j where j.company_id=c.id and j.status='completed') completed,
  (select count(*) from job j where j.company_id=c.id and j.status not in ('completed','canceled')) open_jobs,
  (select count(*) from job j where j.company_id=c.id and j.xano_status='no_fix_possible') condemn,
  (select count(*) from technician t where t.company_id=c.id and t.active) techs,
  (select count(*) from customer cu where cu.company_id=c.id) customers,
  (select count(*) from invoice i where i.company_id=c.id) invoices,
  (select coalesce(sum(total_cents),0) from invoice i where i.company_id=c.id and i.status='paid') collected_cents,
  (select coalesce(sum(total_cents),0) from invoice i where i.company_id=c.id) billed_cents,
  greatest(coalesce((select max(created_at) from job j where j.company_id=c.id), c.created_at), c.created_at) last_activity
from company c
order by jobs desc, c.created_at asc`;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const token = await getSecret('SUPABASE_MGMT_TOKEN');
  if (!token) return json(200, { ok: false, error: 'SUPABASE_MGMT_TOKEN not vaulted' });
  const ref = refFromUrl(await getSecret('PLATFORM_SUPABASE_URL')) || 'tntbhfwitytkcoqlejwc';

  let rows = [];
  try {
    const r = await fetch(`${MGMT}/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: SQL }), signal: AbortSignal.timeout(24000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json(200, { ok: false, error: 'query ' + r.status + ' ' + JSON.stringify(d).slice(0, 200) });
    rows = Array.isArray(d) ? d : (d.result || []);
  } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) }); }

  const now = Date.now(), DAY = 86400000;
  const tenants = rows.map((r) => ({
    name: r.name, slug: r.slug, trade: r.trade || '', plan: r.plan || '',
    created_at: r.created_at, last_activity: r.last_activity,
    jobs: n(r.jobs), completed: n(r.completed), open_jobs: n(r.open_jobs), condemn: n(r.condemn),
    techs: n(r.techs), customers: n(r.customers), invoices: n(r.invoices),
    collected_cents: n(r.collected_cents), billed_cents: n(r.billed_cents),
    active: n(r.jobs) > 0,
  }));

  const sum = (f) => tenants.reduce((a, t) => a + t[f], 0);
  const within = (iso, days) => { const t = iso ? Date.parse(iso) : 0; return t && (now - t) <= days * DAY; };
  const totals = {
    tenants: tenants.length,
    active_tenants: tenants.filter((t) => t.active).length,
    new_30d: tenants.filter((t) => within(t.created_at, 30)).length,
    new_7d: tenants.filter((t) => within(t.created_at, 7)).length,
    active_7d: tenants.filter((t) => within(t.last_activity, 7)).length,
    jobs: sum('jobs'), completed: sum('completed'), open_jobs: sum('open_jobs'),
    techs: sum('techs'), customers: sum('customers'), invoices: sum('invoices'),
    collected_cents: sum('collected_cents'), billed_cents: sum('billed_cents'),
    trades: [...new Set(tenants.map((t) => t.trade).filter(Boolean))].length,
  };
  return json(200, { ok: true, generated_at: new Date().toISOString(), totals, tenants });
};
