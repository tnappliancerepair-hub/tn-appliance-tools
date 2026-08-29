// platform-email-intake — a warranty dispatch email becomes a job on the shop's board.
//
// A Cloudflare Email Worker (catch-all on jobs.assistant247.net) parses the inbound MIME and
// POSTs it here. We resolve the shop from the to-address (<slug>@jobs.assistant247.net),
// extract the job (known-vendor parsers + a Claude fallback via _lib/warranty-email), and
// land it on that shop's board — RLS-bypassing service key, company_id stamped in code,
// deduped by claim #, idempotent per email Message-ID.
//
//   POST ?secret=<PLATFORM_EMAIL_SECRET|admin>
//     { to, from, subject, text?, html?, xml?, message_id? }
//   -> { ok, company, jobs:[{job_id, claim, customer, appliance, status}], method, vendor }
'use strict';

const { getSecret } = require('./_lib/secrets');
const WE = require('./_lib/warranty-email');
let sendSms; try { ({ sendSms } = require('./_lib/sms')); } catch (_) { sendSms = null; }

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
const SITE = 'https://tnapplianceexchange.net';
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}
function rest(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(8000) }); return r.ok ? r.json() : []; },
    async insert(table, row) {
      const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error((d && (d.message || d.hint)) || ('insert ' + table + ' ' + r.status));
      return Array.isArray(d) ? d[0] : d;
    },
  };
}
function slugFromTo(to) {
  // "Jobs <demo@jobs.assistant247.net>" or "demo@jobs.assistant247.net"
  const m = /<?([^<>@\s]+)@/.exec(String(to || ''));
  return m ? m[1].toLowerCase().trim() : '';
}

// create ONE warranty job on a shop's board (extended createLeadJob: warranty fields + unit attrs)
async function createWarrantyJob(db, co, n) {
  const companyId = co.id;
  const appl = n.appliance || '';
  const kind = co.trade === 'automotive' ? 'vehicle' : (appl || 'appliance');
  // dedup by claim # (or dispatch #) within this shop — a re-sent dispatch must not double-create
  const dedupKey = n.claim_number || n.dispatch_id || '';
  if (dedupKey) {
    const col = n.claim_number ? 'claim_number' : 'dispatch_id';
    const dup = await db.get(`job?company_id=eq.${companyId}&${col}=eq.${encodeURIComponent(dedupKey)}&select=id&limit=1`);
    if (dup && dup[0]) return { job_id: dup[0].id, deduped: true };
  }
  // upsert customer by phone, else by exact name within the shop
  let customer = null;
  if (n.phone) { const f = await db.get(`customer?company_id=eq.${companyId}&phone=eq.${encodeURIComponent(n.phone)}&select=id&limit=1`); customer = f && f[0]; }
  if (!customer && (n.last || n.first)) {
    const f = await db.get(`customer?company_id=eq.${companyId}&first_name=eq.${encodeURIComponent(n.first || '')}&last_name=eq.${encodeURIComponent(n.last || '')}&select=id&limit=1`);
    customer = f && f[0];
  }
  if (!customer) {
    customer = await db.insert('customer', {
      company_id: companyId, first_name: n.first || null, last_name: n.last || null,
      phone: n.phone || null, email: n.email || null, address: n.address || null,
      city: n.city || null, state: n.state || null, zip: n.zip || null,
    });
  }
  const label = [n.brand, appl].filter(Boolean).map((x) => x).join(' ').trim() || (kind === 'vehicle' ? 'Vehicle' : 'Appliance');
  const unit = await db.insert('unit', {
    company_id: companyId, customer_id: customer.id, kind, label,
    attributes: { brand: n.brand || '', model: n.model || '', serial: n.serial || '', appliance_type: appl },
  });
  const job = await db.insert('job', {
    company_id: companyId, customer_id: customer.id, unit_id: unit.id, status: 'new',
    problem: n.problem || (appl ? appl + ' issue' : 'Warranty dispatch'),
    source: 'warranty_email', warranty_company: n.warranty_company || null,
    claim_number: n.claim_number || null, dispatch_id: n.dispatch_id || null,
    service_window: n.service_window || null,
  });
  try {
    await db.insert('thread_message', {
      company_id: companyId, customer_id: customer.id, job_id: job.id, direction: 'in', channel: 'email', sender: 'warranty',
      body: `📥 ${n.warranty_company || 'Warranty'} dispatch${n.claim_number ? ' #' + n.claim_number : ''}: ${label}${n.problem ? ' — ' + n.problem : ''}${n.service_window ? ' · ' + n.service_window : ''}`,
    });
  } catch (_) {}
  try { await db.insert('portal_grant', { company_id: companyId, customer_id: customer.id, job_id: job.id }); } catch (_) {}
  return { job_id: job.id, customer_id: customer.id, deduped: false };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  const q = event.queryStringParameters || {};
  const secret = String(q.secret || '');
  const need = (await getSecret('PLATFORM_EMAIL_SECRET')) || '';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (secret !== need && secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'bad json' }); }
  const email = { to: p.to || '', from: p.from || '', subject: p.subject || '', text: p.text || '', html: p.html || '', xml: p.xml || '', message_id: p.message_id || '' };
  const slug = slugFromTo(email.to);
  if (!slug) return json(200, { ok: false, error: 'no_shop_in_address' });

  const { url, key } = await cfg();
  if (!url || !key) return json(200, { ok: false, error: 'platform_not_configured' });
  const db = rest(url, key);

  const cos = await db.get(`company?slug=eq.${encodeURIComponent(slug)}&select=id,name,trade,settings&limit=1`);
  const co = cos && cos[0];
  if (!co) return json(200, { ok: false, error: 'unknown_shop:' + slug });

  // idempotency — same Message-ID for this shop is processed once
  if (email.message_id) {
    const seen = await db.get(`email_intake?company_id=eq.${co.id}&message_id=eq.${encodeURIComponent(email.message_id)}&select=id,job_id,status&limit=1`);
    if (seen && seen[0]) return json(200, { ok: true, duplicate_email: true, status: seen[0].status, job_id: seen[0].job_id });
  }

  let ex; try { ex = await WE.extractJobs(email); } catch (e) { ex = { vendor: 'unknown', method: 'none', email_type: 'error', confidence: 'low', jobs: [], note: String(e && e.message || e).slice(0, 140) }; }
  const excerpt = String(email.text || WE.stripHtml(email.html) || email.xml || '').slice(0, 2000);

  const made = [];
  let status = 'skipped', detail = ex.note || '';
  try {
    if (ex.jobs && ex.jobs.length) {
      for (const n of ex.jobs) { const r = await createWarrantyJob(db, co, n); made.push({ job_id: r.job_id, deduped: !!r.deduped, claim: n.claim_number, customer: [n.first, n.last].filter(Boolean).join(' '), appliance: n.appliance }); }
      const anyNew = made.some((m) => !m.deduped);
      status = anyNew ? 'created' : 'deduped';
      detail = anyNew ? (made.length + ' job(s)') : 'already on the board (claim match)';
    } else {
      status = ex.method === 'none' ? 'unparsed' : 'skipped';
    }
  } catch (e) { status = 'error'; detail = String(e && e.message || e).slice(0, 160); }

  // audit + idempotency ledger row (also the owner's "📥 Emailed jobs" feed)
  let logRow = null;
  try {
    logRow = await db.insert('email_intake', {
      company_id: co.id, message_id: email.message_id || null, to_addr: email.to, from_addr: email.from, subject: email.subject,
      vendor: ex.vendor, method: ex.method, confidence: ex.confidence, email_type: ex.email_type,
      claim_number: (made[0] && made[0].claim) || (ex.jobs[0] && ex.jobs[0].claim_number) || null,
      job_id: (made[0] && made[0].job_id) || null, status, detail, raw_excerpt: excerpt,
    });
  } catch (_) {}

  // notify the shop on a genuinely NEW job (best-effort, one text per email)
  if (status === 'created' && sendSms) {
    try {
      const s = co.settings || {};
      const cell = String(s.owner_cell || (s.business && s.business.phone) || '').trim();
      if (cell && !(s.email_intake && s.email_intake.notify === false)) {
        const j0 = made.find((m) => !m.deduped) || made[0];
        const body = `📥 New ${ex.jobs[0].warranty_company || 'warranty'} job on your board: ${j0.customer || 'customer'}${j0.appliance ? ' · ' + j0.appliance : ''}${j0.claim ? ' (#' + j0.claim + ')' : ''}. Open AssistAnt to schedule.`;
        await sendSms(cell, body, 'owner', 'platform_email_job');
      }
    } catch (_) {}
  }

  return json(200, { ok: true, company: co.name, slug, vendor: ex.vendor, method: ex.method, email_type: ex.email_type, confidence: ex.confidence, status, jobs: made, log_id: logRow && logRow.id });
};
