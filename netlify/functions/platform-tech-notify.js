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
const { msg: commsMsg } = require('./_lib/comms');
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
    async patch(path, row) { try { await fetch(`${base}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) }); } catch (_) {} },
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
      const text = commsMsg(co.settings, 'otw', { first, shop, tech: techName || 'your technician' });
      if (!text) return json(200, { ok: true, texted: false, off: true });
      let sent = false;
      if (phone) { try { sent = await sendSms(phone, text, 'customer', 'platform_otw'); } catch (_) {} }
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
      // A shop offer is a HOLD for a specific tech + day (renders ghosted in that tech's column).
      const holdTech = /^[0-9a-f-]{36}$/i.test(String(p.tech || '')) ? String(p.tech) : null;
      // Supersede any prior pending offers on this job — one live proposal at a time.
      try { await db.patch(`schedule_offer?job_id=eq.${job.id}&company_id=eq.${companyId}&status=eq.pending`, { status: 'withdrawn', decided_at: new Date().toISOString() }); } catch (_) {}
      await db.insert('schedule_offer', { company_id: companyId, job_id: job.id, customer_id: job.customer_id, direction: 'shop', proposed_day: day, win, note: note || null, technician_id: holdTech, status: 'pending', created_by: techName ? ('office:' + techName) : 'office' });
      let grant = (await db.get(`portal_grant?company_id=eq.${companyId}&customer_id=eq.${job.customer_id}&job_id=eq.${job.id}&revoked=eq.false&select=token&limit=1`))[0];
      if (!grant) grant = await db.insertRet('portal_grant', { company_id: companyId, customer_id: job.customer_id, job_id: job.id });
      const tk = grant && grant.token;
      const link = tk ? `${SITE}/platform/portal.html?t=${tk}` : '';
      const lbl = dayLabel(day) + (win === 'any' ? '' : ' (' + winLabel(win) + ')');
      let sent = false;
      let offText = commsMsg(co.settings, 'offer', { first, shop, day: lbl, link });
      if (offText && note) offText += ' — ' + note;
      if (phone && link && offText) { try { sent = await sendSms(phone, offText, 'customer', 'platform_schedule_offer'); } catch (_) {} }
      await db.insert('thread_message', { company_id: companyId, customer_id: job.customer_id, job_id: job.id, direction: 'out', channel: 'portal', sender: techName ? ('office:' + techName) : 'office', body: '📅 Offered ' + lbl + (phone ? ' — texted them to confirm.' : ' — no phone on file; ask them to open their link.') });
      return json(200, { ok: true, texted: sent, no_phone: !phone, url: link });
    }

    if (doo === 'notify_assigned') {
      // Text the ASSIGNED tech that a job is on their plate (internal alert). The office calls
      // this right after it sets technician_id. Best-effort + deduped so board churn can't spam.
      const jrow = (await db.get(`job?id=eq.${jobId}&company_id=eq.${companyId}&select=technician_id,scheduled_day,problem,unit_id&limit=1`))[0] || {};
      if (!jrow.technician_id) return json(200, { ok: true, texted: false, note: 'no_tech' });
      const trow = (await db.get(`technician?id=eq.${jrow.technician_id}&select=name,app_user_id&limit=1`))[0] || {};
      let tphone = '';
      if (trow.app_user_id) { const au = (await db.get(`app_user?id=eq.${trow.app_user_id}&select=phone&limit=1`))[0]; tphone = au && au.phone ? String(au.phone).trim() : ''; }
      if (!tphone) return json(200, { ok: true, texted: false, note: 'no_tech_phone', tech: trow.name });
      const since = new Date(Date.now() - 10 * 60000).toISOString();
      const recent = await db.get(`thread_message?job_id=eq.${jobId}&channel=eq.assign&created_at=gt.${encodeURIComponent(since)}&select=id&limit=1`);
      if (recent && recent.length) return json(200, { ok: true, texted: false, note: 'deduped' });
      const unit = jrow.unit_id ? (((await db.get(`unit?id=eq.${jrow.unit_id}&select=label&limit=1`))[0]) || {}).label : '';
      const day = jrow.scheduled_day ? dayLabel(jrow.scheduled_day) : 'soon';
      const text = commsMsg(co.settings, 'assigned', { shop, first: cus.first_name || 'customer', unit: unit ? ' · ' + unit : '', problem: jrow.problem || '', day, link: `${SITE}/platform/tech.html` });
      if (!text) return json(200, { ok: true, texted: false, off: true, tech: trow.name });
      let sent = false; try { sent = await sendSms(tphone, text, 'technician', 'platform_assigned'); } catch (_) {}
      await db.insert('thread_message', { company_id: companyId, customer_id: job.customer_id, job_id: job.id, direction: 'out', channel: 'assign', sender: 'system', body: `🧰 Assigned to ${trow.name || 'the tech'} — texted them.` });
      return json(200, { ok: true, texted: sent, tech: trow.name });
    }

    if (doo === 'arrived') {
      // Customer heads-up the moment the tech starts the job on site.
      const text = commsMsg(co.settings, 'arrived', { first, shop, tech: techName || 'your technician' });
      if (!text) return json(200, { ok: true, texted: false, off: true });
      let sent = false;
      if (phone) { try { sent = await sendSms(phone, text, 'customer', 'platform_arrived'); } catch (_) {} }
      await logThread('sms', '🔧 Tech arrived');
      return json(200, { ok: true, texted: sent });
    }

    if (doo === 'complete') {
      // Customer gets the "repair done" note + a link to their summary/receipt in the portal.
      let grant = (await db.get(`portal_grant?company_id=eq.${companyId}&customer_id=eq.${job.customer_id}&job_id=eq.${job.id}&revoked=eq.false&select=token&limit=1`))[0];
      if (!grant) grant = await db.insertRet('portal_grant', { company_id: companyId, customer_id: job.customer_id, job_id: job.id });
      const tk = grant && grant.token; const link = tk ? `${SITE}/platform/portal.html?t=${tk}` : '';
      const text = commsMsg(co.settings, 'complete', { first, shop, link });
      if (!text) return json(200, { ok: true, texted: false, off: true, url: link });
      let sent = false;
      if (phone) { try { sent = await sendSms(phone, text, 'customer', 'platform_complete'); } catch (_) {} }
      await logThread('sms', '✅ Job complete' + (link ? ' — sent summary link' : ''));
      return json(200, { ok: true, texted: sent, url: link });
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
      const text = commsMsg(settings, 'review', { first, shop, review: reviewUrl });
      if (!text) return json(200, { ok: true, texted: false, off: true, url: reviewUrl });
      let sent = false;
      if (phone) { try { sent = await sendSms(phone, text, 'customer', 'platform_review'); } catch (_) {} }
      await logThread('sms', `⭐ Review request sent: ${reviewUrl}`);
      return json(200, { ok: true, texted: sent, url: reviewUrl });
    }

    return json(200, { ok: false, error: 'unknown do' });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
