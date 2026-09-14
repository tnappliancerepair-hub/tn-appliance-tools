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

const { getSecret, criticalSecret } = require('./secrets');
const SITE = 'https://tnapplianceexchange.net';

async function cfg() {
  // PLATFORM-specific names on purpose — the generic SUPABASE_URL/SUPABASE_SERVICE_KEY
  // already point to the ANT OPS archive project. The multi-tenant PLATFORM lives in a
  // SEPARATE Supabase project ("ANT Platforms"), so its creds get their own names.
  // criticalSecret: an empty read makes every lead-to-board write a silent no-op. (2026-09-10)
  const url = (await criticalSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await criticalSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
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

    // IDEMPOTENCY GUARD (the anti-spam fix): a single call can fire capture_lead more
    // than once — Ann re-calls the tool, or Telnyx retries it on a slow response — and
    // each fire used to re-text the owner AND the customer. If this customer already got
    // a job in the last 10 minutes, it's the SAME lead: reuse that job + its link and
    // return deduped:true so the caller sends NEITHER text again. One lead = one owner
    // text + one customer text, period.
    if (customer && customer.id) {
      try {
        const sinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const recent = await db.get(`job?company_id=eq.${companyId}&customer_id=eq.${customer.id}&created_at=gt.${encodeURIComponent(sinceIso)}&select=id&order=created_at.desc&limit=1`);
        const dupe = recent && recent[0];
        if (dupe && dupe.id) {
          let token = '';
          try { const gs = await db.get(`portal_grant?job_id=eq.${dupe.id}&select=token&order=created_at.desc&limit=1`); token = gs && gs[0] && gs[0].token; } catch (_) {}
          return {
            ok: true, deduped: true, job_id: dupe.id, customer_id: customer.id,
            portal_token: token || '',
            portal_url: token ? `${SITE}/p/${token}` : '',
            intake_url: token ? `${SITE}/i/${token}` : '',
          };
        }
      } catch (_) { /* dedup is best-effort — never blocks a real lead */ }
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

    // mint the token — one token opens BOTH the intake page (video/photos/availability/
    // waiver) and, afterward, the status portal.
    let portalToken = '', portalUrl = '', intakeUrl = '';
    try {
      const g = await db.insert('portal_grant', { company_id: companyId, customer_id: customer.id, job_id: job.id });
      portalToken = g && g.token;
      if (portalToken) {
        portalUrl = `${SITE}/p/${portalToken}`;
        intakeUrl = `${SITE}/i/${portalToken}`;
      }
    } catch (_) {}

    return { ok: true, job_id: job.id, customer_id: customer.id, portal_token: portalToken, portal_url: portalUrl, intake_url: intakeUrl };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

// What the PLATFORM knows about a batch of Xano jobs: did the customer send media, and do
// we have a model. Both live here and NOT in Xano's get_unified_tdr_status — that endpoint's
// attachments_count/has_photo count TDR attachments and read 0 on every job with real
// customer intake media (verified 2026-09-11 across 66 recent jobs + 25 known-media jobs).
// Anything keying the "they already answered" decision off Xano alone is reading a field
// that is structurally always zero.
//
// Batched on purpose: the caller loops candidates, so this is 3 requests for the whole run
// instead of 3 per job. Chunked at 150 ids because a PostgREST in.() list is a URL, and
// UUIDs go in UNQUOTED to match the in.() calls already proven against this database
// (platform-appt-reminder, platform-ant) -- a quote is not URL-unreserved, and db.get
// returns [] on a non-ok response, so a mangled filter would fail SILENTLY into "no media".
async function intakeStateByXanoId(xanoIds) {
  const out = {};
  const ids = Array.from(new Set((xanoIds || []).map((n) => Number(n)).filter((n) => n > 0)));
  if (!ids.length) return out;
  const { url, key } = await cfg();
  if (!url || !key) return out;                 // unconfigured -> caller keeps Xano-only behavior
  const db = rest(url, key);
  const chunks = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  for (const c of chunks) {
    const jobs = await db.get(`job?xano_id=in.(${c.join(',')})&select=id,xano_id,unit_id`);
    if (!Array.isArray(jobs) || !jobs.length) continue;
    const jobIds = jobs.map((j) => j.id).filter(Boolean);
    const unitIds = Array.from(new Set(jobs.map((j) => j.unit_id).filter(Boolean)));
    const media = new Set();
    if (jobIds.length) {
      const rows = await db.get(`job_media?job_id=in.(${jobIds.join(',')})&select=job_id`);
      for (const r of (Array.isArray(rows) ? rows : [])) if (r && r.job_id) media.add(r.job_id);
    }
    const models = {};
    if (unitIds.length) {
      const rows = await db.get(`unit?id=in.(${unitIds.join(',')})&select=id,attributes`);
      for (const r of (Array.isArray(rows) ? rows : [])) {
        const m = String(((r && r.attributes) || {}).model || '').trim();
        if (r && r.id) models[r.id] = m;
      }
    }
    for (const j of jobs) {
      out[String(j.xano_id)] = { media: media.has(j.id), model: models[j.unit_id] || '' };
    }
  }
  return out;
}

// ── PAYMENTS ON THE PLATFORM BOARD ──────────────────────────────────────────
// Danielle, 2026-09-14: "Cash payments are not sending me a email on it. Jimmy collected
// 55 cash and wouldn't know if he didn't tell me." He HAD recorded it. The crew cut over
// to the platform on 2026-09-13, and every platform payment surface -- the tech's
// "Mark collected" (platform/tech-job.html markCollected) and all three office-board
// write sites -- lands ONLY in Supabase `invoice` (status/paid_method/paid_at). The
// payment email reads Xano's event_log. Two different databases, so no platform payment
// could ever reach the office. This is the read that closes that gap.
//
// ⚠️ THIS DELIBERATELY DOES NOT USE rest().get(). That helper returns [] on ANY non-ok
// response, so one wrong embed name would report "no payments" forever and look perfectly
// healthy -- the exact dead-signal failure this whole fix exists to kill. On money, a read
// that FAILED must never be indistinguishable from a day with no money. It throws instead.
//
//   recentPaidInvoices({ companyId, sinceMs, limit }) -> [{ id, amount_cents, method, ... }]
async function recentPaidInvoices(opts) {
  const o = opts || {};
  const companyId = String(o.companyId || '').trim();
  if (!companyId) throw new Error('recentPaidInvoices: companyId is required');
  const sinceIso = new Date(Number(o.sinceMs) || (Date.now() - 3 * 86400000)).toISOString();
  const limit = Math.max(1, Math.min(200, Number(o.limit) || 100));

  const { url, key } = await cfg();
  // Unconfigured is NOT the same as empty -- say which, so the caller can tell the office
  // "I couldn't look" instead of silently implying "nothing was collected".
  if (!url || !key) return { ok: false, error: 'platform_not_configured', rows: [] };

  // Scoped to ONE company on purpose: the demo tenant carries its own paid invoices, and
  // an unscoped read would report Joey's Appliance Repair demo money as TN's real money.
  const sel = 'id,job_id,total_cents,collected_cents,paid_method,paid_at,status,'
    + 'job:job_id(id,customer:customer_id(first_name,last_name),technician:technician_id(name),unit:unit_id(label))';
  const path = 'invoice'
    + '?company_id=eq.' + encodeURIComponent(companyId)
    + '&status=eq.paid'
    + '&paid_at=not.is.null'
    + '&paid_at=gte.' + encodeURIComponent(sinceIso)
    + '&select=' + encodeURIComponent(sel)
    + '&order=paid_at.desc&limit=' + limit;

  let r;
  try {
    r = await fetch(url + '/rest/v1/' + path, {
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) { return { ok: false, error: 'platform_unreachable: ' + String(e.message || e), rows: [] }; }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return { ok: false, error: 'platform_read_' + r.status + (t ? ': ' + t.slice(0, 200) : ''), rows: [] };
  }
  const raw = await r.json().catch(() => null);
  if (!Array.isArray(raw)) return { ok: false, error: 'platform_bad_payload', rows: [] };

  const rows = raw.map((v) => {
    const j = v.job || {};
    const c = j.customer || {};
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
    // The tech's "Mark collected" sets status/paid_method/paid_at but NOT collected_cents,
    // so a cash collect reads collected_cents = 0. The office's warranty-EFT split DOES set
    // it, and there it is the real remitted amount (usually less than billed). So: trust
    // collected_cents when it carries a value, else fall back to the invoice total.
    const collected = Number(v.collected_cents) || 0;
    const total = Number(v.total_cents) || 0;
    return {
      id: v.id,
      job_id: v.job_id || (j.id || null),
      amount_cents: collected > 0 ? collected : total,
      method: String(v.paid_method || '').trim(),
      customer: name,
      unit: String((j.unit && j.unit.label) || '').trim(),
      tech: String((j.technician && j.technician.name) || '').trim(),
      paid_at_ms: v.paid_at ? Date.parse(v.paid_at) : 0,
    };
  });
  return { ok: true, rows };
}

module.exports = { createLeadJob, intakeStateByXanoId, recentPaidInvoices };
