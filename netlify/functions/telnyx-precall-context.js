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
let getSecret = null, getSecretFresh = null; try { ({ getSecret, getSecretFresh } = require('./_lib/secrets')); } catch (_) {}

// Known warranty callers → company (and, when it's a specific rep we know, their NAME so
// Ann greets them personally). Config lives in the vault (WARRANTY_CALLER_IDS = JSON map of
// digits -> value) so the office can add numbers as we learn them, plus a small code seed.
// A value may be:  "American Home Shield"  (company only)
//                  "NSA::Angie"            (company::rep)
//                  {"company":"NSA","rep":"Angie"}
// Big call centers rotate ANIs, so this catches the consistent lines / known reps; the
// behavior-based rep flow in Ann's instructions catches the rest.
const WARRANTY_CALLERS_SEED = {
  // '16155551234': 'NSA::Angie',            // ← Angie @ National Service Alliance (add her real number)
  // '18005551234': 'American Home Shield',
};
function parseCaller(v) {
  if (!v) return null;
  if (typeof v === 'object') return { company: v.company || '', rep: v.rep || '' };
  const s = String(v);
  const parts = s.split(/::|\|/);
  return parts.length > 1 ? { company: parts[0].trim(), rep: parts[1].trim() } : { company: s.trim(), rep: '' };
}
async function warrantyCallerFor(digits) {
  const core = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  let map = Object.assign({}, WARRANTY_CALLERS_SEED);
  // getSecretFresh (not getSecret) so a rep saved via auto-learn is recognized on her very
  // next call — the cached read serves a stale-empty map right after a save.
  const rd = getSecretFresh || getSecret;
  if (rd) { try { const raw = await rd('WARRANTY_CALLER_IDS'); if (raw) Object.assign(map, JSON.parse(raw)); } catch (_) {} }
  return parseCaller(map[digits] || map[core] || map['1' + core] || '');
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

// ── CALL-TRACK PERSONAS (Teddy 2026-08-12: "the warranty calls are already ours so we can
// go cheaper on the intelligence, but the cash calls need to be the sharpest and our best
// effort to close jobs"). The persona rides in system_context PER CALL, so the same Ann
// flips posture by who's calling — KNOWN WARRANTY caller → efficient service; EVERYONE
// ELSE (cash / unknown) → sharp closer whose job is to WIN the work.
const PERSONA_CASH = "CALL TRACK — CASH (self-pay): this is our best shot to WIN the job — run your CASH CLOSER PLAYBOOK from your instructions. Lead with genuine empathy, surface what the breakdown is actually costing them, teach honestly why waiting is the expensive option, and guide them to a decision like the best advisor they've ever talked to. Options are transparent — an OEM or an Amazon-equivalent part, and we-install or you-install, every option delivered by us (never read out part numbers). Make the first yes tiny: the quick $50 diagnostic, or a short video of the problem plus a photo of the model-number sticker. Close on a CHOICE, not a yes/no. NEVER let a cash caller hang up empty-handed — always land a concrete next step: booked, a scheduling hold (place_hold), or the intake link sent (send_intake_link).";
const PERSONA_WARRANTY = "CALL TRACK — WARRANTY: this job is already ours, so serve it fast, warm, and accurate — do NOT sell. Confirm the claim, give status, scheduling, and parts clearly, gather availability if it's missing, and connect them straight to their tech if they're on today's route. Efficient and kind: handle it and get them off the phone happy.";
function withPersona(track, ctx) { return `${track === 'warranty' ? PERSONA_WARRANTY : PERSONA_CASH} ${ctx || ''}`.trim(); }

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

// Netlify base64-encodes POST bodies (isBase64Encoded) — a raw JSON.parse on that returns
// {} and we lose the caller ID. Decode first, then parse.
function rawBody(event) {
  let b = event.body || '';
  if (event.isBase64Encoded && b) { try { b = Buffer.from(b, 'base64').toString('utf8'); } catch (_) {} }
  return b;
}

// Absolute last-resort greeting — a plain literal (no function calls) so the fallback
// itself can never throw. If ANYTHING in the brain fails, Ann still answers warmly.
const SAFE_DV = {
  known: false, caller_first: '', caller_name: '',
  greeting: 'Thanks for calling Tennessee Appliance Exchange! Who do I have the pleasure of speaking with?',
  situation: '', has_job: false, appliance: '', tech: '', scheduled_day: '', status: '', part_eta: '',
  is_warranty: false, warranty_company: '', job_id: '', claim_number: '',
  call_track: 'cash',
  system_context: 'This caller is not yet identified. Warmly ask for their name and how we can help, then use your lookup tools.',
};

// BULLETPROOF WRAPPER: the pre-call brain must NEVER fail a call. Any unhandled throw
// anywhere below returns the safe generic greeting (HTTP 200) instead of a 500, so a bug
// or a slow dependency degrades to "warm generic Ann," never a dead/silent call.
exports.handler = async function (event) {
  try {
    return await _handle(event);
  } catch (e) {
    try { if (crud) crud.logEvent('telnyx_precall_error', { err: String((e && e.message) || e).slice(0, 200), at_ms: Date.now() }); } catch (_) {}
    return json(200, { dynamic_variables: SAFE_DV, matched: false, reason: 'error_fallback' });
  }
};

async function _handle(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const raw = rawBody(event);
  let body = {};
  try { body = JSON.parse(raw || '{}'); } catch (_) {}
  const q = event.queryStringParameters || {};
  const from = callerFrom(body, q);
  const digits = String(from || '').replace(/\D/g, '');

  // Debug (fire-and-forget, non-blocking): capture exactly what Telnyx sends so we can
  // confirm greet-by-name fires and pinpoint the caller-ID field. Logs a truncated RAW
  // body so we see the real payload shape. Never awaited, never throws into the call path.
  try { if (crud) crud.logEvent('telnyx_precall_hit', { body_keys: Object.keys(body || {}).slice(0, 20), from_resolved: from || '', digits_len: digits.length, b64: !!event.isBase64Encoded, raw: String(raw || '').slice(0, 500), at_ms: Date.now() }); } catch (_) {}

  // Generic, warm fallback — used for an unknown caller OR any lookup hiccup, so the
  // call NEVER waits on us. The assistant just asks who it's speaking with.
  const generic = {
    known: false,
    caller_first: '',
    caller_name: '',
    greeting: 'Thanks for calling Tennessee Appliance Exchange! Who do I have the pleasure of speaking with?',
    situation: '',
    has_job: false,
    appliance: '', tech: '', scheduled_day: '', status: '', part_eta: '',
    is_warranty: false, warranty_company: '',
    job_id: '', claim_number: '',
    // Unknown caller → default to the CASH CLOSER track ("everyone else → sharp closer").
    // If the lookup later reveals a warranty job, the base instructions still handle it.
    call_track: 'cash',
    system_context: withPersona('cash', 'This caller is not yet identified. Warmly ask for their name and how we can help, then use your lookup tools.'),
  };

  if (!digits || digits.length < 10) return json(200, { dynamic_variables: generic, matched: false, reason: 'no_caller_id' });

  // ── DEMO OVERRIDE (remove before go-live) ────────────────────────────────────────
  // Teddy's own cell isn't a customer, so his test calls greet generically and hide the
  // magic. This makes HIS calls to the shadow line demonstrate the full gold-standard
  // flow (greet by name, the "we've been trying to reach you" chase, gather availability
  // live, offer the waiver). Only affects his number; real customers get real data.
  const demoCore = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;

  // ── TEST OVERRIDE — FORCE A FRESH, UNKNOWN CASH CALLER (Teddy 2026-08-13: "make sure my
  // number isn't in there so it just greets me with the sale"). Teddy's cell is attached to
  // a magnet job (19065), which would otherwise greet him by name. Listing a number here
  // makes Ann open with the cash-closer flow instead. Runs BEFORE the demo + the lookup so
  // it always wins. Remove the number to restore normal greet-by-name recognition.
  // (Was Teddy's cell, forced-unknown so he could test the fresh cash-caller flow.
  // Cleared 2026-08-13 so a known caller — including Teddy — is greeted BY NAME with
  // their appliance/appointment, the real returning-customer experience.)
  const FORCE_UNKNOWN = new Set([]);
  if (FORCE_UNKNOWN.has(demoCore)) return json(200, { dynamic_variables: generic, matched: false, reason: 'forced_unknown_test' });

  // ── KNOWN WARRANTY-COMPANY CALLER — greet by company + run the fast rep flow, routing to
  // the WARRANTY DESK (Danielle first). (Teddy 2026-08-13.) Short-circuits before the
  // customer lookup: the call center won't match a customer record anyway.
  const wc = await warrantyCallerFor(digits);
  if (wc && wc.company) {
    // Greet a known rep BY NAME (relationship touch); otherwise greet by company.
    const hi = wc.rep
      ? `${wc.rep}! So good to hear from you — happy to help.`
      : `${wc.company}! You must be one of their representatives — happy to help.`;
    const repDv = {
      known: true, caller_first: wc.rep || '', caller_name: wc.rep || '',
      greeting: `${hi} Can you give me the work order number, and confirm the customer's name for me?`,
      situation: '', has_job: false, appliance: '', tech: '', scheduled_day: '', status: '', part_eta: '',
      is_warranty: true, warranty_company: wc.company, job_id: '', claim_number: '',
      call_track: 'warranty', warranty_rep: true, rep_name: wc.rep || '',
      system_context: `WARRANTY REP CALL from ${wc.company}${wc.rep ? ` — this is ${wc.rep}, a rep we know, so greet her warmly by name` : ''} (recognized by caller ID). Run the WARRANTY REP flow fast and efficiently: get the work order / claim number, look up and CONFIRM the customer, REPEAT the work order number and customer name back, then call alert_office with the claim, say "connecting you to our office manager Danielle," and use the transfer tool to the WARRANTY DESK target (rings Danielle first, then Sofia). Do NOT sell. Do NOT close out a recall claim.`,
    };
    return json(200, { dynamic_variables: repDv, matched: true, warranty_rep: true, company: wc.company, rep: wc.rep || '' });
  }

  const DEMO = {
    // TEST SCENARIO (Teddy 2026-08-12): the day-of "connect me to my tech" flow. Job 19065
    // resolves to tech id 1 (Teddy) with his own cell, so connect_to_tech + the Teddy
    // transfer target + message_for_tech all route to HIS phone — no real tech gets a test
    // text, and his line being busy on the call naturally exercises the no-answer fallback
    // (ring ~5×, then Ann takes the message and texts it to the tech).
    '6154855795': {
      known: true, caller_first: 'Teddy', caller_name: 'Teddy Pivacek',
      greeting: "Hi Teddy! Thanks for calling Tennessee Appliance Exchange. I see you're on our schedule for today — what can I help you with?",
      situation: "you're on our schedule for today",
      has_job: true, appliance: 'dryer', tech: 'Teddy', scheduled_day: 'today', status: 'scheduled',
      is_warranty: false, warranty_company: '', job_id: '19065', claim_number: '',
      needs_availability: false, needs_waiver: false, outreach_count: 0, being_chased: false,
      scheduled_today: true, can_connect_tech: true, tech_first: 'Teddy',
      system_context: "TEST CALL for the owner — the day-of CONNECT-TO-TECH flow. Teddy is ON TODAY'S route with his tech (also Teddy). If he asks where his tech is, when he'll arrive, or just to check on today's appointment, OFFER TO CONNECT HIM: \"It looks like you're on Teddy's schedule today — would you like me to connect you with him? Give me just a minute.\" On yes: call connect_to_tech with job_id 19065, then use the transfer tool to the Teddy target. It rings about five times; on this test his own line is busy so it will not pick up — then come back warmly, take his message, use message_for_tech (tech_name Teddy, his message in his own words, his callback number), and confirm you texted it straight to Teddy. Never quote a clock time — day-of routing.",
    },
  };
  // OFF for go-live — every caller (including Teddy) now gets their REAL data. Set env
  // TELNYX_DEMO=1 to re-enable the owner test scenario for a demo/test session.
  if (process.env.TELNYX_DEMO === '1' && DEMO[demoCore]) return json(200, { dynamic_variables: DEMO[demoCore], matched: true, demo: true });
  // ─────────────────────────────────────────────────────────────────────────────────

  // Resolve the caller through the ONE brain (job-truth) AND pull the customer record
  // (for waiver status) IN PARALLEL — but HARD-CAPPED at ~2s total. Telnyx times out this
  // dynamic-variables webhook in a couple seconds; if it doesn't get a value in time it
  // speaks the literal "{{greeting}}". So the WHOLE lookup races a 2s deadline and, if it
  // loses, we return the warm generic greeting immediately (a real greeting, never a
  // placeholder). (Teddy 2026-08-12: "it said 'greeting'.")
  let f = null, customerLine = '', waiverSignedAt = null;
  try {
    const jtP = fetch(`${SITE}/.netlify/functions/job-truth?phone=${digits}&lens=customer`, { signal: AbortSignal.timeout(1900) }).then((r) => r.json()).catch(() => null);
    const cxP = fetch(`${XANO}/lookup_customer_by_phone?phone=${digits}`, { signal: AbortSignal.timeout(1600) }).then((r) => r.json()).catch(() => null);
    const TIMED_OUT = Symbol('timeout');
    const raced = await Promise.race([Promise.all([jtP, cxP]), new Promise((res) => setTimeout(() => res(TIMED_OUT), 2000))]);
    if (raced !== TIMED_OUT) {
      const [d, cust] = raced;
      if (d && d.found) { f = d.facts || {}; customerLine = (d.lenses && d.lenses.customer) || ''; }
      if (cust && cust.found && cust.customer) waiverSignedAt = Number(cust.customer.last_waiver_signed_at || 0);
    }
  } catch (_) { /* fall through to generic */ }

  if (!f) return json(200, { dynamic_variables: generic, matched: false, reason: digits ? 'no_match_or_slow' : 'no_caller_id' });

  // THE WHOLE STORY — how many times we've reached out about this job (the "we've been
  // trying to reach you" signal). Best-effort + time-boxed so it never delays the open.
  let outreach = 0;
  const jobIdNum = Number(f.job_id || 0);
  if (jobIdNum && intakeCap) {
    try { outreach = await Promise.race([intakeCap.outreachCount(jobIdNum), new Promise((res) => setTimeout(() => res(0), 600))]); } catch (_) { outreach = 0; }
    outreach = Number(outreach) || 0;
  }

  // ── ON TODAY'S ROUTE? — the day-of "where's my tech" call (Teddy 2026-08-12: connect
  // them straight to their tech, cut out the office). Compare the scheduled day to today
  // in Central; if it's today AND a tech is assigned (in-zone), Ann can offer to connect.
  const ymdCT = (ms) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms)); } catch (_) { return ''; } };
  const schedMs = Number(f.scheduled_start_ms || 0);
  const scheduledToday = !!schedMs && ymdCT(schedMs) === ymdCT(Date.now());
  const techSafe = (f.tech_name_safe || '').trim();
  const techFirst = techSafe ? techSafe.split(/\s+/)[0] : '';
  // Daytime only (techs are in the field ~7a–8p CT) — never ring a tech's cell at odd hours.
  const nowHrCT = (function () { try { let h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).formatToParts(new Date()).find((p) => p.type === 'hour').value); return h === 24 ? 0 : h; } catch (_) { return 12; } })();
  const canConnectTech = scheduledToday && !!techFirst && nowHrCT >= 7 && nowHrCT < 20;

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

  const hi = first ? `Hi ${first}!` : 'Thanks for calling Tennessee Appliance!';
  let greeting;
  if (chasing) {
    // Gold-standard open: acknowledge the chase WARMLY (relieved, never accusatory) and
    // pivot to closing it live on the call instead of another round of texts.
    greeting = `${hi} I'm so glad you caught us — we've been trying to reach you to get ${ap} scheduled. Instead of going back and forth by text, let's just take care of it right now. What days work for you — and on those days, are you pretty wide open, or do you need mornings or afternoons?`;
  } else if (situation) {
    greeting = `${hi} Thanks for calling Tennessee Appliance. I see ${situation} — is that what you're calling about, or is it something else?`;
  } else if (needsAvailability) {
    greeting = `${hi} Thanks for calling Tennessee Appliance. Let's get ${ap} scheduled — what days work for you, and on those days are you pretty wide open, or do you need mornings or afternoons?`;
  } else {
    greeting = `${hi} Thanks for calling Tennessee Appliance Exchange. How can I help you today?`;
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
    canConnectTech && `ON TODAY'S ROUTE with ${techFirst}. If they're calling to check on arrival / where their tech is / when they'll be there, OFFER TO CONNECT THEM STRAIGHT TO ${techFirst}: "It looks like you're on ${techFirst}'s schedule today — would you like me to connect you with him? Give me just a minute." On yes, use connect_to_tech then transfer to ${techFirst}. Remember we run day-of routing — never quote a clock time yourself; ${techFirst} gives the live window.`,
    f.office_note && `Latest office note: ${f.office_note}.`,
    customerLine && `Say-it-straight status line: ${customerLine}`,
  ].filter(Boolean);

  // CALL TRACK: known warranty caller → efficient service (cheaper effort); everyone else
  // → sharp cash closer. The persona rides at the FRONT of system_context so it frames the
  // whole call.
  const track = f.is_warranty ? 'warranty' : 'cash';

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
    // day-of "where's my tech" — connect them straight to their tech
    scheduled_today: scheduledToday, can_connect_tech: canConnectTech, tech_first: techFirst,
    call_track: track,
    system_context: withPersona(track, ctxBits.join(' ')),
  };

  return json(200, { dynamic_variables: dv, matched: true, job_id: dv.job_id, call_track: track });
};
