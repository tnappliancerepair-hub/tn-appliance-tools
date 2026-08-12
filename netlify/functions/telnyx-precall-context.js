// telnyx-precall-context — the "greet you by name, already knowing what's going on"
// brain for the Telnyx Voice AI test assistant (Teddy 2026-08-12: "build our AI on
// Telnyx as a test but make it even better — greeting customers by name and already
// knowing what's going on").
//
// THE IDEA / why it beats the current Vapi setup:
//   On Telnyx-native there's no RingCentral/Vapi masking, so the REAL caller ID lands
//   with the call. We look the caller up BEFORE the assistant speaks and hand it the
//   customer's name + their exact job (tech, day, status, part ETA) as dynamic
//   variables. First words become "Hi Norman, I see John's coming Thursday for your
//   oven — is that what you're calling about?" instead of "Can I get your name?".
//   The lookup happens off the call path (during the pickup), so there's no mid-call
//   dead-air / cold-start silence-timeout that used to drop Vapi calls.
//
// Reuses the ONE brain: job-truth (phone -> facts + customer lens). No new logic.
//
// Wire on the Telnyx AI Assistant as its Dynamic Variables webhook (POST). Telnyx
// posts the call context; we return { dynamic_variables: {...} } which the greeting +
// instructions reference as {{caller_first}}, {{greeting}}, {{situation}}, etc.
//
//   POST (Telnyx)  { data:{ payload:{ from, to, call_control_id } } }  ->  { dynamic_variables }
//   GET  ?phone=+16155551234    (test harness — same payload, easy to eyeball)
'use strict';

const SITE = 'https://tnapplianceexchange.net';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
let crud = null; try { crud = require('./_lib/xano/metadata-crud'); } catch (_) {}
let intakeCap = null; try { intakeCap = require('./_lib/intake-cap'); } catch (_) {}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

// Telnyx tucks the caller number in a few possible spots depending on the webhook
// (AI assistant dynamic-vars vs call-control). Pull it from wherever it lands.
function callerFrom(body, q) {
  if (q && q.phone) return q.phone;
  const b = body || {};
  const cands = [
    b.from, b.caller, b.telnyx_end_user_target,
    b.data && b.data.payload && b.data.payload.from,
    b.data && b.data.payload && b.data.payload.from && b.data.payload.from.phone_number,
    b.payload && b.payload.from,
    b.call && b.call.from,
  ];
  for (const c of cands) {
    if (!c) continue;
    if (typeof c === 'string' && c.replace(/\D/g, '').length >= 10) return c;
    if (c && c.phone_number) return c.phone_number;
  }
  return '';
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const from = callerFrom(body, q);
  const digits = String(from || '').replace(/\D/g, '');

  // Debug (fire-and-forget, non-blocking): capture exactly what Telnyx sends on the
  // first real calls so we can confirm greet-by-name fires and fix the caller-ID field
  // if their payload differs. Never awaited, never throws into the call path.
  try { if (crud) crud.logEvent('telnyx_precall_hit', { body_keys: Object.keys(body || {}).slice(0, 20), from_resolved: from || '', digits_len: digits.length, at_ms: Date.now() }); } catch (_) {}

  // Generic, warm fallback — used for an unknown caller OR any lookup hiccup, so the
  // call NEVER waits on us. The assistant just asks who it's speaking with.
  const generic = {
    known: false,
    caller_first: '',
    caller_name: '',
    greeting: 'Thanks for calling TN Appliance Exchange! Who do I have the pleasure of speaking with?',
    situation: '',
    has_job: false,
    appliance: '', tech: '', scheduled_day: '', status: '', part_eta: '',
    is_warranty: false, warranty_company: '',
    job_id: '', claim_number: '',
    system_context: 'This caller is not yet identified. Warmly ask for their name and how we can help, then use your lookup tools.',
  };

  if (!digits || digits.length < 10) return json(200, { dynamic_variables: generic, matched: false, reason: 'no_caller_id' });

  // ── DEMO OVERRIDE (remove before go-live) ────────────────────────────────────────
  // Teddy's own cell isn't a customer, so his test calls greet generically and hide the
  // magic. This makes HIS calls to the shadow line demonstrate the full gold-standard
  // flow (greet by name, the "we've been trying to reach you" chase, gather availability
  // live, offer the waiver). Only affects his number; real customers get real data.
  const demoCore = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  const DEMO = {
    '6154855795': {
      known: true, caller_first: 'Teddy', caller_name: 'Teddy Pivacek',
      greeting: "Hi Teddy! I'm so glad you caught us — we've actually been trying to reach you to get your dryer repair scheduled. Instead of going back and forth by text, let's just take care of it right now. What days work for you — and on those days, are you pretty wide open, or do you need mornings or afternoons? And just tell me anything that won't work, and we'll route it the best we can for you.",
      situation: "we've been trying to reach you to schedule your dryer repair",
      has_job: true, appliance: 'dryer', tech: '', scheduled_day: '', status: 'needs_more_info',
      is_warranty: false, warranty_company: '', job_id: '', claim_number: '',
      needs_availability: true, needs_waiver: true, outreach_count: 3, being_chased: true,
      system_context: "DEMO CALL for the owner. Caller is Teddy about a dryer repair that is not scheduled yet. We have reached out 3 times and still have NO availability on file — warmly acknowledge we've been trying to reach them (never accusatory) and gather their available days LIVE with capture_availability. The service waiver is NOT signed — after getting their days, offer to text the waiver with send_waiver_link. Keep it warm and natural; this is a demo of closing the loop on the call.",
    },
  };
  if (DEMO[demoCore]) return json(200, { dynamic_variables: DEMO[demoCore], matched: true, demo: true });
  // ─────────────────────────────────────────────────────────────────────────────────

  // Resolve the caller through the ONE brain (job-truth) AND pull the customer record
  // (for waiver status) IN PARALLEL, hard-capped so a slow lookup can't delay the
  // greeting — fall back to the warm generic instead.
  let f = null, customerLine = '', waiverSignedAt = null;
  try {
    const jtP = fetch(`${SITE}/.netlify/functions/job-truth?phone=${digits}&lens=customer`, { signal: AbortSignal.timeout(4500) }).then((r) => r.json()).catch(() => null);
    const cxP = fetch(`${XANO}/lookup_customer_by_phone?phone=${digits}`, { signal: AbortSignal.timeout(2500) }).then((r) => r.json()).catch(() => null);
    const [d, cust] = await Promise.all([jtP, cxP]);
    if (d && d.found) { f = d.facts || {}; customerLine = (d.lenses && d.lenses.customer) || ''; }
    if (cust && cust.found && cust.customer) waiverSignedAt = Number(cust.customer.last_waiver_signed_at || 0);
  } catch (_) { /* fall through to generic */ }

  if (!f) return json(200, { dynamic_variables: generic, matched: false, reason: digits ? 'no_match' : 'no_caller_id' });

  // THE WHOLE STORY — how many times we've reached out about this job (the "we've been
  // trying to reach you" signal). Best-effort + time-boxed so it never delays the open.
  let outreach = 0;
  const jobIdNum = Number(f.job_id || 0);
  if (jobIdNum && intakeCap) {
    try { outreach = await Promise.race([intakeCap.outreachCount(jobIdNum), new Promise((res) => setTimeout(() => res(0), 1300))]); } catch (_) { outreach = 0; }
    outreach = Number(outreach) || 0;
  }

  const first = (f.customer_first || '').trim();
  // job-truth defaults a blank appliance to the literal word "appliance" — treat that
  // (and empty) as unknown so we never say "your appliance" or "Appliance: appliance".
  const applianceRaw = (f.appliance || '').trim();
  const appliance = /^appliance$/i.test(applianceRaw) ? '' : applianceRaw;
  const ap = appliance ? `your ${appliance}` : 'your repair';
  const tech = (f.tech_name_safe || '').trim();
  const day = (f.scheduled_day || '').trim();
  const status = (f.status || '').trim();
  const eta = (f.part_eta || '').trim();

  // A proactive one-liner the assistant leads with — derived from the customer lens
  // but phrased as a heads-up so it can open the call knowing the situation.
  // Only lead with a situation when we're CONFIDENT (an active, current job). For
  // ambiguous states (pending / needs_more_info / completed / canceled / no day) we
  // just greet by name and ask open-ended — a wrong assumption ("in our queue" when
  // the repair is actually done) is worse than none. The full status still rides in
  // system_context so the AI knows it if the customer brings the old job up.
  let situation = '';
  if (/await|part|order/.test(status)) situation = `we've diagnosed ${ap} and we're waiting on the part${(day || eta) ? ', expected ' + (day || eta) : ''}`;
  else if (/in_progress|started/.test(status)) situation = `${tech || 'your tech'} is working on ${ap} right now`;
  else if (day && !/cancel|complete|done/.test(status)) situation = `you're scheduled with ${tech || 'your tech'} for ${day}${appliance ? ' for your ' + appliance : ''}`;

  // THE GAPS — what's still open on this job, so Ann closes exactly the right thing.
  const availability = (f.availability || '').trim();
  const activeJob = !!f.job_id && !/complete|done|cancel/i.test(status);
  const needsAvailability = activeJob && !availability && !day;   // no days on file AND not already scheduled
  const needsWaiver = activeJob && waiverSignedAt === 0;          // 0 = explicitly never signed; null = unknown, don't assume
  const chasing = needsAvailability && outreach >= 2;            // we've asked 2+ times, still nothing → the Mrs. Jones move

  const hi = first ? `Hi ${first}!` : 'Thanks for calling TN Appliance!';
  let greeting;
  if (chasing) {
    // Gold-standard open: acknowledge the chase WARMLY (relieved, never accusatory) and
    // pivot to closing it live on the call instead of another round of texts.
    greeting = `${hi} I'm so glad you caught us — we've been trying to reach you to get ${ap} scheduled. Instead of going back and forth by text, let's just take care of it right now. What days work for you — and on those days, are you pretty wide open, or do you need mornings or afternoons?`;
  } else if (situation) {
    greeting = `${hi} Thanks for calling TN Appliance. I see ${situation} — is that what you're calling about, or is it something else?`;
  } else if (needsAvailability) {
    greeting = `${hi} Thanks for calling TN Appliance. Let's get ${ap} scheduled — what days work for you, and on those days are you pretty wide open, or do you need mornings or afternoons?`;
  } else {
    greeting = `${hi} Thanks for calling TN Appliance Exchange. How can I help you today?`;
  }

  // Full context injected into the assistant's instructions so it "already knows"
  // for the WHOLE call, not just the greeting.
  const ctxBits = [
    first && `Caller: ${first} (${f.customer_name || ''}).`,
    appliance && `Appliance: ${appliance}${f.model ? ' (' + f.model + ')' : ''}.`,
    status && `Job status: ${status}.`,
    tech && `Assigned tech: ${tech}.`,
    day && `Scheduled day: ${day} (we run day-of routing — never quote a clock time; a live arrival window is texted that morning).`,
    eta && `Part ETA: ${eta}.`,
    f.is_warranty && `Warranty job${f.warranty_company ? ' (' + f.warranty_company + ')' : ''}.`,
    f.problem && `Reported problem: ${f.problem}.`,
    // ── THE WHOLE STORY: outreach history + open gaps, so Ann closes the right thing ──
    outreach > 0 && `Outreach so far: we've reached out ${outreach} time(s) about this job.`,
    availability && `Availability on file: ${availability}.`,
    needsAvailability && (outreach >= 2
      ? `NO availability on file and we've texted ${outreach} times with no result — warmly acknowledge we've been trying to reach them (maybe texting isn't landing) and gather their days LIVE on this call with capture_availability.`
      : `No availability on file yet — gather their available days live and record with capture_availability.`),
    (waiverSignedAt === 0) && `Service waiver NOT signed yet — offer to text the waiver link (use send_waiver_link).`,
    (waiverSignedAt > 0) && `Service waiver: signed.`,
    f.office_note && `Latest office note: ${f.office_note}.`,
    customerLine && `Say-it-straight status line: ${customerLine}`,
  ].filter(Boolean);

  const dv = {
    known: true,
    caller_first: first,
    caller_name: f.customer_name || '',
    greeting,
    situation,
    has_job: !!(f.job_id),
    appliance, tech, scheduled_day: day, status, part_eta: eta,
    is_warranty: !!f.is_warranty, warranty_company: f.warranty_company || '',
    job_id: String(f.job_id || ''), claim_number: f.claim_number || '',
    // gap flags — Ann uses these to close exactly what's open
    needs_availability: needsAvailability, needs_waiver: waiverSignedAt === 0,
    outreach_count: outreach, being_chased: chasing,
    system_context: ctxBits.join(' '),
  };

  return json(200, { dynamic_variables: dv, matched: true, job_id: dv.job_id });
};
