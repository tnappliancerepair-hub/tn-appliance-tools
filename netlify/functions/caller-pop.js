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

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const digits = String(callerFrom(body, q) || '').replace(/\D/g, '');
  const test = q.test === '1';
  if (digits.length < 10) return json(200, { ok: false, reason: 'no_caller_id' });

  // Dedupe — don't fire twice for the same ringing call.
  try {
    const seen = await crud.searchOne(crud.TABLES.event_log, { action: 'caller_pop_sent' }, { id: 'desc' });
    if (seen) { const m = typeof seen.metadata === 'string' ? JSON.parse(seen.metadata) : (seen.metadata || {}); if (String(m.phone || '').replace(/\D/g, '') === digits && Date.now() - Number(m.at_ms || 0) < DEDUPE_MS) return json(200, { ok: true, deduped: true }); }
  } catch (_) {}

  // Resolve the whole story from the pre-call brain.
  let dv = null;
  try {
    const r = await fetch(`${SITE}/.netlify/functions/telnyx-precall-context?phone=${digits}`, { signal: AbortSignal.timeout(6000) });
    dv = (await r.json().catch(() => null) || {}).dynamic_variables || null;
  } catch (_) {}

  const name = (dv && (dv.caller_name || dv.caller_first)) || 'Caller';
  const jobId = dv && dv.job_id ? String(dv.job_id) : '';
  const appliance = (dv && dv.appliance) || '';
  const day = (dv && dv.scheduled_day) || '';
  const outreach = Number(dv && dv.outreach_count) || 0;

  // Build a crisp office one-liner (internal phrasing, not the customer greeting).
  const bits = [];
  if (appliance) bits.push(appliance);
  if (day) bits.push(`scheduled ${day}`);
  else if (dv && dv.needs_availability) bits.push(outreach >= 2 ? `needs scheduling — reached out ${outreach}×, no availability` : 'needs scheduling');
  else if (dv && /await|part|order/.test(String(dv.status || ''))) bits.push('awaiting parts');
  if (dv && dv.needs_waiver) bits.push('waiver unsigned');
  const summary = bits.length ? bits.join(' · ') : (dv && dv.known ? 'existing customer' : 'not in our system yet');

  // The tap-link: STRAIGHT to the job (no search) when we have it; else phone search.
  const link = jobId ? `${SITE}/job-detail.html?job_id=${jobId}` : `${SITE}/customer-search.html?phone=${digits}`;
  const pretty = digits.length === 11 ? `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}` : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  const msg = `📞 Incoming — ${name} (${pretty})\n${summary}\nTap to open → ${link}`;

  if (q.dry === '1') return json(200, { ok: true, dry: true, caller: name, job_id: jobId, summary, link, message: msg });

  const targets = test ? OFFICE.filter((o) => o.role === 'owner') : OFFICE;
  const results = [];
  if (sendSms) {
    for (const o of targets) {
      try { const sent = await sendSms(o.phone, msg, o.role, 'caller_pop'); results.push({ who: o.name, sent: !!sent }); }
      catch (e) { results.push({ who: o.name, sent: false, err: String((e && e.message) || e).slice(0, 60) }); }
    }
  }
  try { await crud.logEvent('caller_pop_sent', { phone: digits, job_id: jobId, name, summary, at_ms: Date.now() }); } catch (_) {}

  return json(200, { ok: true, caller: name, job_id: jobId, summary, link, sent_to: results, message: msg });
};
