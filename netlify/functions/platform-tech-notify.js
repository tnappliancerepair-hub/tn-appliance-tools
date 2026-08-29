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
const SITE = 'https://tnapplianceexchange.net';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
function winLabel(w) { return w === 'am' ? 'mornings' : (w === 'pm' ? 'afternoons' : 'anytime'); }
function dayLabel(d) { try { return new Date(String(d) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); } catch (_) { return String(d); } }

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
    async insertRet(table, row) { const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); const d = await r.json().catch(() => null); return Array.isArray(d) ? d[0] : d; },
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
  const us = await db.get(`app_user?auth_user_id=eq.${u.id}&select=company_id,name&limit=1`);
  const companyId = us && us[0] && us[0].company_id;
  const techName = (us && us[0] && us[0].name) || '';
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

    if (doo === 'message') {
      // Free-form text from the tech to the customer, logged to the SAME shared thread the
      // office tile + customer portal read. sender 'tech:<name>' so every surface shows who.
      const text = String(p.body || '').trim().slice(0, 1000);
      if (!text) return json(200, { ok: false, error: 'empty' });
      let sent = false;
      if (phone) { try { sent = await sendSms(phone, text, 'customer', 'platform_tech_msg'); } catch (_) {} }
      await db.insert('thread_message', { company_id: companyId, customer_id: job.customer_id, job_id: job.id, direction: 'out', channel: 'sms', sender: techName ? ('tech:' + techName) : 'tech', body: text });
      return json(200, { ok: true, texted: sent, no_phone: !phone });
    }

    if (doo === 'office_message') {
      // Same as `message`, but from the OFFICE (an app_user without a tech role). Auth is
      // already company-scoped above, so this is safe; we only relabel the sender as
      // 'office:<name>' so the shared thread shows who spoke — office, tech, or customer.
      const text = String(p.body || '').trim().slice(0, 1000);
      if (!text) return json(200, { ok: false, error: 'empty' });
      let sent = false;
      if (phone) { try { sent = await sendSms(phone, text, 'customer', 'platform_office_msg'); } catch (_) {} }
      await db.insert('thread_message', { company_id: companyId, customer_id: job.customer_id, job_id: job.id, direction: 'out', channel: 'sms', sender: techName ? ('office:' + techName) : 'office', body: text });
      return json(200, { ok: true, texted: sent, no_phone: !phone });
    }

    if (doo === 'schedule_offer') {
      // The office offers the customer a day. Record the shop offer (they accept/decline from
      // their portal) AND text them the day + a one-tap portal link so it hits their phone —
      // not just the board. The handshake works both ways: customer requests, shop offers.
      const day = String(p.day || '').trim();
      const win = ['am', 'pm', 'any'].includes(String(p.win || '')) ? String(p.win) : 'any';
      const note = String(p.note || '').trim().slice(0, 200);
      if (!day) return json(200, { ok: false, error: 'need day' });
      await db.insert('schedule_offer', { company_id: companyId, job_id: job.id, customer_id: job.customer_id, direction: 'shop', proposed_day: day, win, note: note || null, status: 'pending', created_by: techName ? ('office:' + techName) : 'office' });
      let grant = (await db.get(`portal_grant?company_id=eq.${companyId}&customer_id=eq.${job.customer_id}&job_id=eq.${job.id}&revoked=eq.false&select=token&limit=1`))[0];
      if (!grant) grant = await db.insertRet('portal_grant', { company_id: companyId, customer_id: job.customer_id, job_id: job.id });
      const tk = grant && grant.token;
      const link = tk ? `${SITE}/platform/portal.html?t=${tk}` : '';
      const lbl = dayLabel(day) + (win === 'any' ? '' : ' (' + winLabel(win) + ')');
      let sent = false;
      if (phone && link) { const msg = `${shop}: we can come out ${lbl} for your repair${note ? ' — ' + note : ''}. Tap to confirm, or pick a different day: ${link}`; try { sent = await sendSms(phone, msg, 'customer', 'platform_schedule_offer'); } catch (_) {} }
      await db.insert('thread_message', { company_id: companyId, customer_id: job.customer_id, job_id: job.id, direction: 'out', channel: 'portal', sender: techName ? ('office:' + techName) : 'office', body: '📅 Offered ' + lbl + (phone ? ' — texted them to confirm.' : ' — no phone on file; ask them to open their link.') });
      return json(200, { ok: true, texted: sent, no_phone: !phone, url: link });
    }

    if (doo === 'waiver_link') {
      // Text the customer the intake/sign link (same /i/<token> the lead flow uses) so they
      // can sign the release on their own phone — for when they didn't sign before the visit.
      if (!phone) return json(200, { ok: true, texted: false, error: 'no_phone' });
      let grant = (await db.get(`portal_grant?company_id=eq.${companyId}&customer_id=eq.${job.customer_id}&job_id=eq.${job.id}&revoked=eq.false&select=token&limit=1`))[0];
      if (!grant) grant = await db.insertRet('portal_grant', { company_id: companyId, customer_id: job.customer_id, job_id: job.id });
      const tk = grant && grant.token;
      if (!tk) return json(200, { ok: false, error: 'grant_failed' });
      const link = `${SITE}/i/${tk}`;
      const msg = `${shop}: quick release of liability to sign before we work on your appliance — tap here, takes 20 seconds: ${link}`;
      let sent = false;
      try { sent = await sendSms(phone, msg, 'customer', 'platform_waiver_link'); } catch (_) {}
      await logThread('sms', `✍️ Sign-waiver link sent: ${link}`);
      return json(200, { ok: true, texted: sent, url: link });
    }

    if (doo === 'review') {
      const settings = co.settings || {};
      const reviewUrl = String(settings.review_url || '').trim() || `https://www.google.com/search?q=${encodeURIComponent(shop + ' reviews')}`;
      const msg = `Hi ${first}, how did ${shop} do today? If we earned it, a quick Google review means the world 🙏 ${reviewUrl} — and if anything was off, just reply here and we'll make it right.`;
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
