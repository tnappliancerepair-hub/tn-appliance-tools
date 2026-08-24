// platform-tech-notify — the tech texts the customer from the job (platform). Two actions:
//   otw    — "on my way" heads-up (the page opens navigation client-side)
//   review — post-job review request with the shop's review link
// Auth is the tech's Supabase session (verified server-side), scoped to his own shop + job.
// Reuses TN's SMS sender (trial shops text from TN's number today); also logs to the
// customer's portal thread so it shows in portal.html.
//
//   POST ?do=otw     { job, access_token }  -> { ok }
//   POST ?do=review  { job, access_token }  -> { ok, url }
'use strict';

const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
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
    async insert(table, row) { try { await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); } catch (_) {} },
  };
}
async function authUser(base, key, accessToken) {
  if (!accessToken) return null;
  try { const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: 'Bearer ' + accessToken }, signal: AbortSignal.timeout(8000) }); if (!r.ok) return null; const u = await r.json(); return (u && u.id) ? u : null; } catch (_) { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const p = Object.assign({}, body, q);
  const doo = String(q.do || p.do || '');
  const jobId = String(p.job || '').trim();
  const token = String(p.access_token || '').trim();

  const { url, key } = await cfg();
  if (!url || !key) return json(200, { ok: false, error: 'platform_not_configured' });
  const db = rest(url, key);

  const u = await authUser(url, key, token);
  if (!u) return json(200, { ok: false, error: 'not_signed_in' });

  // scope: caller's company must own the job
  const us = await db.get(`app_user?auth_user_id=eq.${u.id}&select=company_id&limit=1`);
  const companyId = us && us[0] && us[0].company_id;
  if (!companyId) return json(200, { ok: false, error: 'no_company' });
  const jobs = await db.get(`job?id=eq.${jobId}&company_id=eq.${companyId}&select=id,customer_id&limit=1`);
  const job = jobs && jobs[0];
  if (!job) return json(200, { ok: false, error: 'not_your_job' });

  const cus = (await db.get(`customer?id=eq.${job.customer_id}&select=first_name,phone&limit=1`))[0] || {};
  const co = (await db.get(`company?id=eq.${companyId}&select=name,settings&limit=1`))[0] || {};
  const shop = co.name || 'your appliance shop';
  const first = cus.first_name || 'there';
  const phone = String(cus.phone || '').trim();
  const logThread = (channel, txt) => db.insert('thread_message', { company_id: companyId, customer_id: job.customer_id, job_id: job.id, direction: 'out', channel, sender: 'tech', body: txt });

  try {
    if (doo === 'otw') {
      const msg = `Hi ${first} — your technician from ${shop} is on the way. See you soon! 🚚`;
      let sent = false;
      if (phone) { try { sent = await sendSms(phone, msg, 'customer', 'platform_otw'); } catch (_) {} }
      await logThread('sms', '🚚 On my way');
      return json(200, { ok: true, texted: sent });
    }

    if (doo === 'review') {
      const settings = co.settings || {};
      const reviewUrl = String(settings.review_url || '').trim() || `https://www.google.com/search?q=${encodeURIComponent(shop + ' reviews')}`;
      const msg = `Thanks for choosing ${shop}, ${first}! If we did right by you, a quick review means the world: ${reviewUrl}`;
      let sent = false;
      if (phone) { try { sent = await sendSms(phone, msg, 'customer', 'platform_review'); } catch (_) {} }
      await logThread('sms', `⭐ Review request sent: ${reviewUrl}`);
      return json(200, { ok: true, texted: sent, url: reviewUrl });
    }

    return json(200, { ok: false, error: 'unknown do' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
