// platform-thread — mirror an INBOUND customer text into the platform's shared thread
// (Supabase / ANT Platforms), so the conversation the office reads on messages.html, the
// tech reads on his job page, and the customer reads in their portal is genuinely two-way.
//
// This is a BRIDGE, and it is deliberately one-directional and non-blocking:
//   * It only READS the customer via the existing platform_call_lookup RPC (last-10-digit
//     phone matching — platform phones are stored in mixed formats) and INSERTS one row.
//   * It NEVER throws, never replies, never texts, and never changes a job. Whatever the
//     live inbound handler was going to do, it still does — this just also writes it down.
//   * Every call is time-boxed so a slow platform can't delay an inbound webhook.
//
// TN is tenant #1 and these are TN's Telnyx numbers, so inbound is scoped to TN's company.
// When a shop brings its own number, resolve the company from the DIALED number instead.
'use strict';

const { getSecret } = require('./secrets');
const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const DEDUP_MS = 3 * 60 * 1000;   // a redelivered webhook must not double-post the thread

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}

/**
 * @param {{phone:string, body:string, channel?:string, companyId?:string}} o
 * @returns {Promise<{ok:boolean, reason?:string, id?:string, customer_id?:string, job_id?:string|null}>}
 */
async function teeInbound(o) {
  try {
    const phone = String((o && o.phone) || '').trim();
    const body = String((o && o.body) || '').trim().slice(0, 1000);
    if (!phone || !body) return { ok: false, reason: 'no_phone_or_body' };

    const { url, key } = await cfg();
    if (!url || !key) return { ok: false, reason: 'platform_not_configured' };
    const companyId = String((o && o.companyId) || TN_COMPANY);
    const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

    // Who is this? The same resolver the phone AI uses — normalized last-10 match.
    const lr = await fetch(`${url}/rest/v1/rpc/platform_call_lookup`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ p_company_id: companyId, p_phone: phone, p_claim: null, p_name: null }),
      signal: AbortSignal.timeout(7000),
    });
    if (!lr.ok) return { ok: false, reason: 'lookup_http_' + lr.status };
    const look = await lr.json().catch(() => null);
    const cust = look && look.customer;
    if (!look || !look.found || !cust || !cust.id) return { ok: false, reason: 'no_customer' };
    const jobId = (look.job && look.job.id) || null;

    // A webhook can be redelivered. The same words from the same person inside a few
    // minutes is the same text, not two.
    const since = new Date(Date.now() - DEDUP_MS).toISOString();
    const dq = `${url}/rest/v1/thread_message?company_id=eq.${companyId}&customer_id=eq.${cust.id}` +
      `&direction=eq.in&created_at=gt.${encodeURIComponent(since)}&select=id,body&limit=25`;
    const dr = await fetch(dq, { headers: H, signal: AbortSignal.timeout(6000) });
    const recent = dr.ok ? await dr.json().catch(() => []) : [];
    if (Array.isArray(recent) && recent.some((m) => String(m.body || '').trim() === body)) {
      return { ok: true, reason: 'duplicate_skipped', customer_id: cust.id, job_id: jobId };
    }

    const ir = await fetch(`${url}/rest/v1/thread_message`, {
      method: 'POST', headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify({
        company_id: companyId, customer_id: cust.id, job_id: jobId,
        direction: 'in', channel: String((o && o.channel) || 'sms'), sender: 'customer', body,
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!ir.ok) return { ok: false, reason: 'insert_http_' + ir.status };
    const rows = await ir.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { ok: false, reason: 'insert_returned_nothing' };
    return { ok: true, id: row.id, customer_id: cust.id, job_id: jobId };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e).slice(0, 120) };
  }
}

module.exports = { teeInbound, TN_COMPANY };
