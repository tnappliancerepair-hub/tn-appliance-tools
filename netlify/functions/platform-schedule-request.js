// platform-schedule-request — the customer taps "request this day" in their portal, and it
// (1) records the request via the token-gated portal_request_day RPC (offer row + thread note)
// AND (2) TEXTS the shop's scheduler so a real request hits their phone the second it lands —
// they don't have to be watching the board. Token IS the auth (only someone holding the portal
// link can fire it, and it only ever texts that one shop's own cell). Best-effort SMS: the
// request is still recorded even if the shop set no cell.
//
//   POST { t:<portal token>, day:"YYYY-MM-DD", win:"am|pm|any", note?:string }
'use strict';

const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');

const PLATFORM_ANON = 'sb_publishable_gtcSGgZWhqkrUxdPxFhKrA_CwUBcyq7';
const SITE = 'https://tnapplianceexchange.net';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }
function winLabel(w) { return w === 'am' ? 'mornings' : (w === 'pm' ? 'afternoons' : 'anytime'); }
function dayLabel(d) {
  try { return new Date(String(d) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
  catch (_) { return String(d); }
}

exports.handler = async function (event) {
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const token = String(b.t || b.token || '').trim();
  const day = String(b.day || '').trim();
  const win = ['am', 'pm', 'any'].includes(String(b.win || '')) ? String(b.win) : 'any';
  const note = String(b.note || '').trim().slice(0, 200);
  if (!token || !day) return json(200, { ok: false, error: 'need t (token) and day' });

  const url = String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!url || !key) return json(200, { ok: false, error: 'platform_not_configured' });

  // 1) record the request through the SAME token-gated SECURITY DEFINER path the portal uses.
  //    Runs with the anon key so the token is validated server-side (no RLS bypass here).
  let recorded = false, recErr = null;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/portal_request_day`, {
      method: 'POST',
      headers: { apikey: PLATFORM_ANON, Authorization: 'Bearer ' + PLATFORM_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token, p_day: day, p_win: win, p_note: note || null }),
      signal: AbortSignal.timeout(9000),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.ok) recorded = true;
    else recErr = (d && d.error) || ('rpc ' + r.status);
  } catch (e) { recErr = String((e && e.message) || e).slice(0, 120); }
  if (!recorded) return json(200, { ok: false, error: recErr || 'could not record the request' });

  // 2) resolve the shop's scheduler cell + the customer name + the job to deep-link — with the
  //    service key (server-only). Best-effort: any miss just skips the text.
  let texted = false, jobId = null;
  try {
    const H = { apikey: key, Authorization: 'Bearer ' + key };
    const grants = await fetch(`${url}/rest/v1/portal_grant?token=eq.${encodeURIComponent(token)}&select=company_id,customer_id,job_id&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) }).then((x) => x.ok ? x.json() : []).catch(() => []);
    const g = grants && grants[0];
    if (g) {
      const [cos, custs, openJobs] = await Promise.all([
        fetch(`${url}/rest/v1/company?id=eq.${g.company_id}&select=name,settings&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) }).then((x) => x.ok ? x.json() : []).catch(() => []),
        fetch(`${url}/rest/v1/customer?id=eq.${g.customer_id}&select=first_name,last_name&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) }).then((x) => x.ok ? x.json() : []).catch(() => []),
        fetch(`${url}/rest/v1/job?customer_id=eq.${g.customer_id}&company_id=eq.${g.company_id}&status=not.in.(completed,canceled)&order=created_at.desc&select=id&limit=1`, { headers: H, signal: AbortSignal.timeout(8000) }).then((x) => x.ok ? x.json() : []).catch(() => []),
      ]);
      const co = cos && cos[0];
      const cust = custs && custs[0];
      jobId = g.job_id || (openJobs && openJobs[0] && openJobs[0].id) || null;
      const cell = co && co.settings && co.settings.business && co.settings.business.phone;
      const shopName = (co && co.name) || 'your shop';
      const who = cust ? [cust.first_name, cust.last_name].filter(Boolean).join(' ').trim() : 'A customer';
      if (cell) {
        const link = jobId ? `${SITE}/platform/office-board.html?job=${encodeURIComponent(jobId)}` : `${SITE}/platform/office-board.html`;
        const msg = `📅 ${shopName}: ${who || 'A customer'} is asking for ${dayLabel(day)} (${winLabel(win)})${note ? ' — ' + note : ''}. Open the board to offer it or book it: ${link}`;
        try { texted = await sendSms(cell, msg, 'office', 'platform_day_request'); } catch (_) { texted = false; }
      }
    }
  } catch (_) { /* recorded already; SMS is a bonus */ }

  return json(200, { ok: true, recorded: true, texted, job_id: jobId });
};
