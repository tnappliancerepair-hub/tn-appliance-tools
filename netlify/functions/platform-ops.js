// platform-ops — the OPERATOR / CRM view of the Ant platform: a client INVENTORY with
// quality-control on growth vs churn (who's on, who's new, who's gone quiet, who left).
// A shop's own login is RLS-scoped to itself and can never see across tenants; this
// owner-gated endpoint aggregates every company with the mgmt token. Client-focused:
// status + health + dates, NOT each shop's operational/money detail. Backs ops.html.
//
//   GET ?secret=<admin>   -> { ok, totals:{...}, clients:[{...}], test:[{...}] }
'use strict';
const { getSecret } = require('./_lib/secrets');
const MGMT = 'https://api.supabase.com/v1';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
// Platform operators — a valid Supabase login for one of these emails may open the
// operator dashboard WITHOUT the admin key (one-tap, same session the shop apps use).
const OPERATOR_EMAILS = ['tnappliancerepair@gmail.com'];
const PLATFORM_ANON = 'sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7'; // publishable, browser-safe
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function refFromUrl(u) { const m = String(u || '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i); return m ? m[1] : ''; }
const n = (v) => { const x = parseInt(v, 10); return isNaN(x) ? 0 : x; };

// Accept a Supabase operator session (Authorization: Bearer <jwt>) as an alternative to
// the admin key — verified against Supabase, email must be a platform operator.
async function operatorFromJWT(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const m = String(auth).match(/Bearer\s+(.+)/i);
  if (!m) return null;
  const base = (await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co';
  try {
    const r = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: 'Bearer ' + m[1], apikey: PLATFORM_ANON }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    const email = String((u && u.email) || '').toLowerCase();
    return OPERATOR_EMAILS.includes(email) ? email : null;
  } catch (_) { return null; }
}

const SQL = `
select c.name, c.slug, c.trade, coalesce(c.status,'active') status, c.plan, c.created_at, c.churned_at,
  (select u.name  from app_user u where u.company_id=c.id and u.role='owner' order by u.created_at asc limit 1) owner_name,
  (select u.email from app_user u where u.company_id=c.id and u.role='owner' order by u.created_at asc limit 1) owner_email,
  (select count(*) from job j where j.company_id=c.id) jobs,
  (select max(j.created_at) from job j where j.company_id=c.id) last_job
from company c
order by (coalesce(c.status,'active')='test'), c.created_at asc`;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard && !(await operatorFromJWT(event))) return json(403, { ok: false, error: 'forbidden' });
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
  const RETENTION_DAYS = 30; // keep a churned client's data 30 days, then it can be purged.
  const daysSince = (iso) => iso ? (now - Date.parse(iso)) / DAY : Infinity;
  const shape = (r) => {
    const last = r.last_job || r.created_at;
    const jobs = n(r.jobs);
    const ageDays = daysSince(r.created_at);
    const idleDays = jobs > 0 ? daysSince(r.last_job) : ageDays;
    let health;
    if (r.status === 'churned') health = 'left';
    else if (r.status === 'paused') health = 'paused';
    else if (ageDays <= 14) health = 'new';
    else if (idleDays <= 30) health = 'healthy';
    else if (idleDays <= 60) health = 'quiet';
    else health = 'at_risk';
    const o = {
      name: r.name, slug: r.slug, trade: r.trade || '', status: r.status,
      owner_name: r.owner_name || '', owner_email: r.owner_email || '',
      created_at: r.created_at, churned_at: r.churned_at, last_activity: last,
      jobs, health,
    };
    if (r.status === 'churned') {
      const since = daysSince(r.churned_at);
      o.purge_in_days = Math.max(0, Math.ceil(RETENTION_DAYS - since));
      o.purge_eligible = since >= RETENTION_DAYS;
    }
    return o;
  };

  const all = rows.map(shape);
  const clients = all.filter((t) => t.status !== 'test');
  const test = all.filter((t) => t.status === 'test');
  const within = (iso, d) => { const t = iso ? Date.parse(iso) : 0; return t && (now - t) <= d * DAY; };
  const cnt = (f) => clients.filter(f).length;

  const churned = cnt((t) => t.status === 'churned');
  const totals = {
    clients: clients.length,
    active: cnt((t) => t.status === 'active'),
    trial: cnt((t) => t.status === 'trial'),
    paused: cnt((t) => t.status === 'paused'),
    churned,
    new_30d: cnt((t) => within(t.created_at, 30)),
    new_7d: cnt((t) => within(t.created_at, 7)),
    lost_30d: cnt((t) => t.status === 'churned' && within(t.churned_at, 30)),
    quiet: cnt((t) => t.health === 'quiet' || t.health === 'at_risk'),
    retention_pct: clients.length ? Math.round(100 * (clients.length - churned) / clients.length) : 100,
    trades: [...new Set(clients.map((t) => t.trade).filter(Boolean))].length,
    due_purge: cnt((t) => t.status === 'churned' && t.purge_eligible),
    retention_days: RETENTION_DAYS,
    test: test.length,
  };
  return json(200, { ok: true, generated_at: new Date().toISOString(), totals, clients, test });
};
