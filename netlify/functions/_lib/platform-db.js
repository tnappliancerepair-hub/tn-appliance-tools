// platform-db — the bridge from the phones (Ann) to the platform database (Supabase).
// When Ann captures a lead for a shop, this turns it into a real JOB on that shop's
// board: upsert the customer, create the serviced unit, open the job, drop the lead
// into the conversation thread, and mint a customer portal link. That's what makes the
// phone product and the database product ONE thing — a call becomes a job the office
// sees, the tech works, and the customer can follow.
//
// Runs SERVER-SIDE only (Netlify), using the Supabase SERVICE key from the vault — that
// key bypasses Row-Level Security and must never touch the browser. If the platform isn't
// configured yet (no URL/service key vaulted), every call no-ops with {ok:false} so the
// caller (e.g. the Ann lead tool) still does its SMS job — the bridge is purely additive.
//
//   createLeadJob({ slug, name, phone, what, detail, city, source })
//     -> { ok, job_id, portal_token, portal_url }  (or { ok:false, error })
'use strict';

const { getSecret } = require('./secrets');
const SITE = 'https://tnapplianceexchange.net';

async function cfg() {
  const url = (await getSecret('SUPABASE_URL')) || (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('SUPABASE_SERVICE_KEY')) || (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}

function splitName(name) {
  const s = String(name || '').trim();
  if (!s) return { first: '', last: '' };
  const parts = s.split(/\s+/);
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// tiny PostgREST client (service key → bypasses RLS; server-only)
function rest(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) {
      const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(8000) });
      return r.ok ? r.json() : [];
    },
    async insert(table, row) {
      const r = await fetch(`${base}/rest/v1/${table}`, {
        method: 'POST', headers: { ...H, Prefer: 'return=representation' },
        body: JSON.stringify(row), signal: AbortSignal.timeout(8000),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error((d && (d.message || d.hint)) || ('insert ' + table + ' ' + r.status));
      return Array.isArray(d) ? d[0] : d;
    },
  };
}

async function createLeadJob(lead) {
  try {
    const { url, key } = await cfg();
    if (!url || !key) return { ok: false, error: 'platform_not_configured' };
    const slug = String(lead.slug || '').toLowerCase().trim();
    if (!slug) return { ok: false, error: 'no_slug' };

    const db = rest(url, key);
    const cos = await db.get(`company?slug=eq.${encodeURIComponent(slug)}&select=id,trade,settings&limit=1`);
    const co = cos && cos[0];
    if (!co) return { ok: false, error: 'unknown_shop:' + slug };
    const companyId = co.id;
    const kind = co.trade === 'automotive' ? 'vehicle' : 'appliance';

    // upsert customer by phone within this tenant (best-effort match; else create)
    const { first, last } = splitName(lead.name);
    const digits = String(lead.phone || '').replace(/\D/g, '').slice(-10);
    let customer = null;
    if (digits) {
      const found = await db.get(`customer?company_id=eq.${companyId}&phone=eq.${encodeURIComponent(lead.phone)}&select=id&limit=1`);
      customer = found && found[0];
    }
    if (!customer) {
      customer = await db.insert('customer', {
        company_id: companyId, first_name: first || null, last_name: last || null,
        phone: lead.phone || null, city: lead.city || null,
      });
    }

    // the serviced unit (appliance or vehicle) — trade-agnostic
    const label = String(lead.what || '').trim() || (kind === 'vehicle' ? 'Vehicle' : 'Appliance');
    const unit = await db.insert('unit', {
      company_id: companyId, customer_id: customer.id, kind, label, attributes: {},
    });

    // the job — lands in "New" on the board
    const problem = String(lead.detail || lead.what || '').trim() || 'New lead from Ann';
    const job = await db.insert('job', {
      company_id: companyId, customer_id: customer.id, unit_id: unit.id,
      status: 'new', problem, source: lead.source || 'ann_phone',
    });

    // drop the lead into the conversation thread (so office/tech/customer all see it)
    try {
      await db.insert('thread_message', {
        company_id: companyId, customer_id: customer.id, job_id: job.id,
        direction: 'in', channel: 'call', sender: 'ann',
        body: `New lead: ${label}${problem ? ' — ' + problem : ''}${lead.city ? ' (' + lead.city + ')' : ''}`,
      });
    } catch (_) {}

    // mint a customer portal link for this job
    let portalToken = '', portalUrl = '';
    try {
      const g = await db.insert('portal_grant', { company_id: companyId, customer_id: customer.id, job_id: job.id });
      portalToken = g && g.token;
      if (portalToken) portalUrl = `${SITE}/platform/portal.html?t=${portalToken}`;
    } catch (_) {}

    return { ok: true, job_id: job.id, customer_id: customer.id, portal_token: portalToken, portal_url: portalUrl };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

module.exports = { createLeadJob };
