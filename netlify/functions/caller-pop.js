// caller-pop — "the phone rings and the customer lands on your phone." When a call
// comes in, text the office the caller's WHOLE story + a one-tap link that opens
// STRAIGHT to them — no searching (Teddy 2026-08-12: "help them find the customer when
// they're on their cell; the search is finicky, they shouldn't have to hunt").
//
// Reuses the pre-call brain (telnyx-precall-context) so the text is as rich as what Ann
// knows: name, appliance, status/day, how many times we've reached out, open gaps. The
// tap-link goes to the job directly (job-detail) when we can resolve it — bypassing the
// slow search entirely — and falls back to a phone search only when we can't.
//
//   POST { from | phone }   (fired by the inbound-call webhook)
//   GET  ?phone=+1...&test=1 (test — texts Teddy only)
'use strict';

const SITE = 'https://tnapplianceexchange.net';
const crud = require('./_lib/xano/metadata-crud');
let sendSms; try { ({ sendSms } = require('./_lib/sms')); } catch (_) { sendSms = null; }

const OFFICE = [
  { name: 'Teddy', phone: '+16154855795', role: 'owner' },
  { name: 'Danielle', phone: '+16154850713', role: 'danielle' },
  { name: 'Sofia', phone: '+16292594602', role: 'office' },
];
const DEDUPE_MS = 45 * 1000;   // one pop per caller per 45s (a call shouldn't double-fire)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

function callerFrom(body, q) {
  const b = body || {};
  const cands = [q && q.phone, b.from, b.phone, b.caller, b.data && b.data.payload && b.data.payload.from, b.payload && b.payload.from];
  for (const c of cands) { if (c) { const s = typeof c === 'string' ? c : (c.phone_number || ''); if (String(s).replace(/\D/g, '').length >= 10) return s; } }
  return '';
}

function rawBody(event) {
  let b = event.body || '';
  if (event.isBase64Encoded && b) { try { b = Buffer.from(b, 'base64').toString('utf8'); } catch (_) {} }
  return b;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let body = {}; try { body = JSON.parse(rawBody(event) || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const digits = String(callerFrom(body, q) || '').replace(/\D/g, '');
  const claim = String((q.claim || q.wo || body.claim || body.work_order || '')).trim();
  const jobIdIn = String(q.job_id || body.job_id || '').replace(/\D/g, '');
  const note = String(q.note || body.note || '').trim().slice(0, 120);   // why Ann is handing off, optional
  const test = q.test === '1';
  // pop_only: write the caller_pop_sent event so the LAPTOP corner-card lights up, but
  // do NOT text the office. Used by the inbound-call webhook so a live ring pops every
  // office screen without double-texting (the colony inbound_call agent already SMSes).
  const popOnly = q.pop_only === '1' || body.pop_only === true || q.no_sms === '1';
  if (!claim && !jobIdIn && digits.length < 10) return json(200, { ok: false, reason: 'no_caller_id' });
  const dedupeKey = claim || jobIdIn || digits;

  // Dedupe — don't fire twice for the same ringing call.
  try {
    const seen = await crud.searchOne(crud.TABLES.event_log, { action: 'caller_pop_sent' }, { id: 'desc' });
    if (seen) { const m = typeof seen.metadata === 'string' ? JSON.parse(seen.metadata) : (seen.metadata || {}); if (String(m.key || m.phone || '') === dedupeKey && Date.now() - Number(m.at_ms || 0) < DEDUPE_MS) return json(200, { ok: true, deduped: true }); }
  } catch (_) {}

  // Resolve the whole story three ways: by CLAIM / work-order when a warranty rep calls
  // (their number won't match a customer), by JOB_ID when Ann hands off a caller she's
  // already resolved (she passes {{job_id}}), otherwise by the caller's phone via the
  // pre-call brain.
  let dv = null, viaClaim = false, viaJob = false;
  if (claim || jobIdIn) {
    try {
      const qp = claim ? `claim=${encodeURIComponent(claim)}` : `job_id=${jobIdIn}`;
      const jt = await fetch(`${SITE}/.netlify/functions/job-truth?${qp}&lens=all`, { signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null);
      if (jt && jt.found) {
        const f = jt.facts || {};
        dv = { known: true, caller_name: f.customer_name || f.customer_first || '', caller_first: f.customer_first || '', appliance: /^appliance$/i.test(String(f.appliance || '')) ? '' : (f.appliance || ''), scheduled_day: f.scheduled_day || '', status: f.status || '', job_id: String(f.job_id || jobIdIn || ''), is_warranty: !!f.is_warranty, needs_availability: false, needs_waiver: false, outreach_count: 0 };
      }
      viaClaim = !!claim;
      viaJob = !claim && !!jobIdIn;
    } catch (_) {}
  } else {
    try {
      const r = await fetch(`${SITE}/.netlify/functions/telnyx-precall-context?phone=${digits}`, { signal: AbortSignal.timeout(6000) });
      dv = (await r.json().catch(() => null) || {}).dynamic_variables || null;
    } catch (_) {}
  }

  const name = (dv && (dv.caller_name || dv.caller_first)) || 'Caller';
  const jobId = dv && dv.job_id ? String(dv.job_id) : '';
  const appliance = (dv && dv.appliance) || '';
  const day = (dv && dv.scheduled_day) || '';
  const outreach = Number(dv && dv.outreach_count) || 0;

  // Build a crisp office one-liner (internal phrasing).
  const bits = [];
  if (appliance) bits.push(appliance);
  if (day) bits.push(`scheduled ${day}`);
  else if (dv && dv.needs_availability) bits.push(outreach >= 2 ? `needs scheduling — reached out ${outreach}×, no availability` : 'needs scheduling');
  else if (dv && /await|part|order/.test(String(dv.status || ''))) bits.push('awaiting parts');
  if (dv && dv.needs_waiver && !viaClaim) bits.push('waiver unsigned');
  const summary = bits.length ? bits.join(' · ') : (dv && dv.known ? 'existing customer' : (viaClaim ? 'claim not found — look it up' : 'not in our system yet'));

  // The tap-link: STRAIGHT to the job (no search) when we have it.
  const link = jobId ? `${SITE}/job-detail.html?job_id=${jobId}`
    : (viaClaim ? `${SITE}/warranty-review.html` : `${SITE}/customer-search.html?phone=${digits}`);
  const pretty = digits.length === 11 ? `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}` : (digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : digits);
  // Header: warranty-rep pop (by claim), an AI hand-off (Ann passes job_id + why),
  // or a plain incoming ring.
  const header = viaClaim
    ? `📞 Warranty rep — WO/claim ${claim}${name ? ` · ${name}` : ''}`
    : (viaJob
      ? `🤝 Ann needs a hand — ${name}${note ? `: ${note}` : ' wants a person'}`
      : `📞 Incoming — ${name} (${pretty})`);
  const msg = `${header}\n${summary}\nTap to open → ${link}`;

  if (q.dry === '1') return json(200, { ok: true, dry: true, caller: name, job_id: jobId, summary, link, message: msg });

  const targets = popOnly ? [] : (test ? OFFICE.filter((o) => o.role === 'owner') : OFFICE);
  const results = [];
  if (sendSms) {
    for (const o of targets) {
      try { const sent = await sendSms(o.phone, msg, o.role, 'caller_pop'); results.push({ who: o.name, sent: !!sent }); }
      catch (e) { results.push({ who: o.name, sent: false, err: String((e && e.message) || e).slice(0, 60) }); }
    }
  }
  // Always log the pop — this is what the laptop corner-card widget polls.
  try { await crud.logEvent('caller_pop_sent', { key: dedupeKey, phone: digits, claim, job_id: jobId, name, summary, at_ms: Date.now() }); } catch (_) {}

  return json(200, { ok: true, pop_only: popOnly, caller: name, job_id: jobId, summary, link, sent_to: results, message: msg });
};
