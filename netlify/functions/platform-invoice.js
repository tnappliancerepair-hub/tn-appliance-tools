// platform-invoice — the office INVOICES a customer. Auth is the office user's Supabase
// session (verified server-side, scoped to their shop + the job). Mints (or reuses) a
// portal grant for the customer+job and texts them a link to their hosted invoice
// (/platform/invoice.html?t=<token>), which renders entirely as the shop (their business
// info from company.settings.business). Also logs to the customer's thread.
//
//   POST ?do=send { job, access_token }  -> { ok, url, texted }
'use strict';

const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const SITE = 'https://tnapplianceexchange.net';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
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
    async insert(table, row) { const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); const d = await r.json().catch(() => null); return Array.isArray(d) ? d[0] : d; },
    async note(row) { try { await fetch(`${base}/rest/v1/thread_message`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); } catch (_) {} },
  };
}
async function authUser(base, key, accessToken) {
  if (!accessToken) return null;
  try { const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: 'Bearer ' + accessToken }, signal: AbortSignal.timeout(8000) }); if (!r.ok) return null; const u = await r.json(); return (u && u.id) ? u : null; } catch (_) { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const p = Object.assign({}, body, q);
  const jobId = String(p.job || '').trim();
  const token = String(p.access_token || '').trim();

  const { url, key } = await cfg();
  if (!url || !key) return json(200, { ok: false, error: 'platform_not_configured' });
  const db = rest(url, key);

  const u = await authUser(url, key, token);
  if (!u) return json(200, { ok: false, error: 'not_signed_in' });
  const us = await db.get(`app_user?auth_user_id=eq.${u.id}&select=company_id&limit=1`);
  const companyId = us && us[0] && us[0].company_id;
  if (!companyId) return json(200, { ok: false, error: 'no_company' });

  const jobs = await db.get(`job?id=eq.${jobId}&company_id=eq.${companyId}&select=id,customer_id,unit:unit_id(label)&limit=1`);
  const job = jobs && jobs[0];
  if (!job) return json(200, { ok: false, error: 'not_your_job' });
  if (!job.customer_id) return json(200, { ok: false, error: 'no_customer' });

  const invs = await db.get(`invoice?job_id=eq.${jobId}&company_id=eq.${companyId}&select=id,total_cents&limit=1`);
  if (!invs || !invs[0]) return json(200, { ok: false, error: 'no_invoice' });

  const cus = (await db.get(`customer?id=eq.${job.customer_id}&select=first_name,phone&limit=1`))[0] || {};
  const co = (await db.get(`company?id=eq.${companyId}&select=name&limit=1`))[0] || {};
  const shop = co.name || 'your appliance shop';

  // reuse an existing grant for this customer+job, else mint one
  let grant = (await db.get(`portal_grant?company_id=eq.${companyId}&customer_id=eq.${job.customer_id}&job_id=eq.${jobId}&revoked=eq.false&select=token&limit=1`))[0];
  if (!grant) grant = await db.insert('portal_grant', { company_id: companyId, customer_id: job.customer_id, job_id: jobId });
  const tk = grant && grant.token;
  if (!tk) return json(200, { ok: false, error: 'grant_failed' });

  const inviteUrl = `${SITE}/platform/invoice.html?t=${tk}`;
  const first = cus.first_name || 'there';
  const phone = String(cus.phone || '').trim();
  const appliance = (job.unit && job.unit.label) ? ` for your ${job.unit.label}` : '';
  const msg = `Hi ${first}, here's your invoice from ${shop}${appliance}: ${inviteUrl}`;
  let texted = false;
  if (phone) { try { texted = await sendSms(phone, msg, 'customer', 'platform_invoice'); } catch (_) {} }
  await db.note({ company_id: companyId, customer_id: job.customer_id, job_id: jobId, direction: 'out', channel: 'invoice', sender: 'office', body: `🧾 Invoice sent: ${inviteUrl}` });

  return json(200, { ok: true, url: inviteUrl, texted });
};
