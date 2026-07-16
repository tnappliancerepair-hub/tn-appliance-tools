// tech-customer-message — lets a TECH text his own job's customer straight from
// the field app (tech-job.html), from the shop's customer number, identified as
// himself. Lee 2026-07-14: "I'm not able to text my customers anymore to get
// model/serial photos or ask what's going on — and when I show up they don't
// answer because they don't know who I am."
//
// The tech never handles the raw phone — we resolve it server-side from job_id
// (same chain as sms-thread). We auto-prefix "Lee (TN Appliance):" so the
// customer knows who's reaching out, translate into the customer's language if
// they've been texting in one, and log it into the unified thread with tech
// attribution so office + tech both see it.
//
//   POST { job_id, tech_id, message }  ->  { ok, sent, reason, translated, to_masked }
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const guard = require('./_lib/sms-guard');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const JOBS = crud.TABLES.jobs;         // 7
const CUSTOMER = crud.TABLES.customer; // 6

// Roster — first names for the "Lee (TN Appliance):" identity prefix.
const TECH_NAME = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function last10(v) { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
function asObj(m) { if (typeof m === 'string') { try { return JSON.parse(m); } catch (_) { return {}; } } return m || {}; }
function maskPhone(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? '(' + d.slice(-10, -7) + ') ***-' + d.slice(-4) : ''; }

// Resolve the job's customer phone (last-10) + first name. Same chain sms-thread
// uses: job denorm -> customer record. Returns { phone10, first }.
async function resolveCustomer(jobId) {
  let phone10 = '', first = '', customerId = 0;
  try {
    const job = await crud.searchOne(JOBS, { id: jobId });
    if (job) {
      customerId = Number(job.customer_id) || 0;
      phone10 = last10(job.customer_phone) || last10(job.phone) || last10(job.bill_to_phone);
      first = String(job.customer_first || '').trim();
      if ((!phone10 || !first) && customerId) {
        const cust = await crud.searchOne(CUSTOMER, { id: customerId });
        if (cust) {
          phone10 = phone10 || last10(cust.phone) || last10(cust.mobile) || last10(cust.phone_number);
          first = first || String(cust.first_name || cust.name || '').trim().split(/\s+/)[0] || '';
        }
      }
    }
  } catch (_) {}
  // Last resort: job-truth resolves the phone off the customer record even when
  // the denorm + direct read both come back empty (the warranty-number gap).
  if (!phone10) {
    try {
      const site = process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net';
      const tr = await fetch(`${site}/.netlify/functions/job-truth?job_id=${jobId}&lens=office`, { signal: AbortSignal.timeout(7000) }).then((r) => r.json());
      phone10 = last10((tr && tr.facts && tr.facts.customer_phone) || '');
      first = first || String((tr && tr.facts && tr.facts.customer_first) || '').trim();
    } catch (_) {}
  }
  return { phone10, first };
}

// Newest inbound customer text for this phone — translation context, so a
// Spanish-speaking customer gets the tech's English rendered in Spanish.
async function lastInbound(phone10) {
  if (!phone10) return '';
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=inbound_customer_sms_received&days_back=21&limit=400`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    const rows = (d && (d.items || d.rows)) || [];
    for (const row of rows) {   // newest-first from the function API
      const md = asObj(row.metadata);
      const p = last10(md.phone) || last10(md.from) || last10(md.recipient);
      if (p === phone10) return String(md.body || md.message || md.text || '').slice(0, 800);
    }
  } catch (_) {}
  return '';
}

// Translate the tech's English into the customer's language (best-effort, 6s).
async function translate(english, customerText) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !customerText) return { language: 'English', translated: english };
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: 'You translate a repair technician\'s text for an appliance-repair business. You are given (1) the customer\'s last message in their own language and (2) the tech\'s reply in English. Detect the customer\'s language from their message and translate the English reply naturally into it. If they wrote English, return the reply unchanged. Reply with ONLY compact JSON: {"language":"Spanish|Vietnamese|Arabic|Hindi|English|...","translated":"..."}.',
        messages: [{ role: 'user', content: 'CUSTOMER MESSAGE:\n' + String(customerText).slice(0, 800) + '\n\nTECH REPLY TO TRANSLATE:\n' + String(english).slice(0, 800) }],
      }),
      signal: ctl.signal,
    });
    clearTimeout(tm);
    const d = await r.json();
    const raw = (d && d.content && d.content[0] && d.content[0].text) || '';
    const out = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (out && out.translated) return { language: out.language || 'their language', translated: out.translated };
  } catch (_) {}
  return { language: 'English', translated: english };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(b.job_id, 10) || 0;
  const techId = parseInt(b.tech_id, 10) || 0;
  const message = String(b.message || '').trim();
  if (!jobId) return json(400, { ok: false, error: 'job_id required' });
  if (!message) return json(400, { ok: false, error: 'message required' });
  if (message.length > 900) return json(400, { ok: false, error: 'message too long' });

  const { phone10, first: custFirst } = await resolveCustomer(jobId);
  if (!phone10) return json(200, { ok: false, error: 'no_customer_phone', hint: 'This job has no customer phone on file yet.' });

  const techFirst = TECH_NAME[techId] || 'your tech';

  // Translate the body into the customer's language (if they've texted us in one),
  // THEN add the identity prefix in English so the shop name stays intact.
  const customerText = await lastInbound(phone10);
  const { language, translated } = await translate(message, customerText);

  // Identity prefix so "they know who I am" — skip if the tech already named
  // himself or the shop in the message.
  const alreadyIdentified = new RegExp('tn\\s*appliance|\\b' + techFirst + '\\b', 'i').test(message);
  const full = alreadyIdentified ? translated : (techFirst + ' (TN Appliance): ' + translated);

  // Send FROM the shared HUMAN line (857-8800) — a tech texting his own job's
  // customer is the human lane (Teddy 2026-07-15). human-line-send does the Telnyx
  // send from 857-8800 + logs customer_sms_reply (lane:human, sender = the tech) into
  // the shared per-job thread. Opt-out is enforced there.
  const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://tnapplianceexchange.net';
  let sent = false, reason = '';
  try {
    const r = await fetch(`${SITE}/.netlify/functions/human-line-send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+1' + phone10, message: full, sender: techFirst, job_id: jobId }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({}));
    sent = !!(d && d.sent); reason = (d && d.reason) || '';
  } catch (e) { reason = String((e && e.message) || e); }

  return json(200, {
    ok: sent, sent, reason,
    to_masked: maskPhone(phone10), to_first: custFirst || null,
    language, translated: language !== 'English' ? full : undefined,
  });
};
