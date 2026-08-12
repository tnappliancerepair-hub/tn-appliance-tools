// telnyx-ai-tool — the "close the loop" tool router for the Telnyx Voice AI assistant
// (Teddy 2026-08-12: "closing the loop matters most — every call should actually DO the
// next step, not end at 'someone will call you back'").
//
// The assistant calls this MID-CALL to take real action, then speaks the returned
// `result`. Every action REUSES an existing, proven endpoint — we never rebuild the
// customer-facing chain, so the sacred pre-diagnosis flow is untouched. All customer
// texts still ride the Xano send_sms gate (opt-out, hours, approved line).
//
// Routing: POST .../telnyx-ai-tool?do=<action>  with the tool arguments in the body.
// Telnyx posts the tool's arguments; we read them defensively (body, body.arguments,
// body.data.arguments) so we're robust to its exact envelope.
//
//   do=send_intake_link   { job_id }                      -> texts the pre-diagnosis link (THE chain)
//   do=capture_availability { job_id, available, unavailable? }
//   do=send_pay_link      { job_id }                      -> texts the durable pay link
//   do=capture_callback   { name, phone, summary, caller_type? }
//   do=log_outcome        { job_id?, summary, needs_office?, urgent?, warranty? }  -> never lose a call
//   do=ping                                               -> health check
'use strict';

const SITE = 'https://tnapplianceexchange.net';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const crud = require('./_lib/xano/metadata-crud');
let sendSms; try { ({ sendSms } = require('./_lib/sms')); } catch (_) { sendSms = null; }

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

// Telnyx may deliver the tool arguments at the top level, or under .arguments /
// .data.arguments / .payload — flatten them into one args object.
function argsOf(body) {
  const b = body || {};
  const layers = [b, b.arguments, b.args, b.data, b.data && b.data.arguments, b.payload, b.payload && b.payload.arguments];
  const out = {};
  for (const L of layers) { if (L && typeof L === 'object') for (const k of Object.keys(L)) if (out[k] === undefined && typeof L[k] !== 'object') out[k] = L[k]; }
  return out;
}
// Netlify base64-encodes POST bodies — decode before JSON.parse or Telnyx tool args
// (job_id, day, etc.) come back empty and every tool silently no-ops.
function rawBody(event) {
  let b = event.body || '';
  if (event.isBase64Encoded && b) { try { b = Buffer.from(b, 'base64').toString('utf8'); } catch (_) {} }
  return b;
}
function post(path, payload, ms = 12000) {
  return fetch(`${SITE}/.netlify/functions/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(ms) }).then((r) => r.json()).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
}
// A tool reply: `result` is what the assistant SAYS; keep it short + spoken-natural.
const say = (result, extra) => json(200, { ok: true, result, ...(extra || {}) });

// Is a live person available RIGHT NOW? Office is staffed Mon–Fri 9am–6pm Central; Ann is
// 24/7. Warm transfers only happen when the office is open — off-hours we take a message.
function officeOpenCT() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date());
  const wd = (parts.find((p) => p.type === 'weekday') || {}).value || '';
  let hr = Number((parts.find((p) => p.type === 'hour') || {}).value); if (hr === 24) hr = 0;
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(wd);
  return isWeekday && hr >= 9 && hr < 18;
}

// Resolve a spoken day ("Friday", "tomorrow", "next Wednesday", "8/15") to a concrete
// CT date — SERVER-SIDE so Ann never does date math (LLMs get it wrong; CLAUDE.md rule).
const WKD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function resolveDayCT(dayStr) {
  const s = String(dayStr || '').trim().toLowerCase();
  if (!s) return null;
  // "now" in CT wall-clock, as a Date whose local fields equal Central time.
  const base = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  base.setHours(12, 0, 0, 0);
  const out = new Date(base);
  let matched = false;
  const mdy = s.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
  if (/\btoday\b/.test(s)) { matched = true; }
  else if (/\btomorrow\b/.test(s)) { out.setDate(out.getDate() + 1); matched = true; }
  else if (mdy) {
    const mm = Number(mdy[1]) - 1, dd = Number(mdy[2]);
    out.setMonth(mm, dd);
    if (out.getTime() < base.getTime() - 3 * 864e5) out.setFullYear(out.getFullYear() + 1); // past → next year
    matched = true;
  } else {
    for (let i = 0; i < 7; i++) {
      if (s.includes(WKD[i])) {
        let off = (i - base.getDay() + 7) % 7;                 // upcoming occurrence, today counts as 0
        if (/\bnext\b/.test(s) && off < 7) off += 7;           // "next Friday" = the following week
        out.setDate(out.getDate() + off);
        matched = true; break;
      }
    }
  }
  if (!matched) return null;
  const y = out.getFullYear(), m = out.getMonth() + 1, d = out.getDate();
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const label = out.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
  return { date: iso, label };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  const doAction = String(q.do || q.action || '').toLowerCase();

  // Optional shared-token gate (fast, no vault round-trip). If TELNYX_TOOL_SECRET is
  // set we require ?k=, else we allow (shadow-pilot friendly). Harden before go-live.
  const need = process.env.TELNYX_TOOL_SECRET || '';
  if (need && q.k !== need && doAction !== 'ping') return json(200, { ok: false, result: "Sorry, I hit a snag on my end — let me take a note and have the office follow up." });

  if (doAction === 'ping') return say('pong', { ts: Date.now() });

  // LOOK UP AN UNKNOWN CALLER — by phone / claim / name — so an unrecognized caller who
  // gives their info isn't a dead end. Resolves through the ONE brain (job-truth).
  if (doAction === 'lookup') {
    try {
      let b0 = {}; try { b0 = JSON.parse(rawBody(event) || '{}'); } catch (_) {}
      const aa = argsOf(b0);
      const ph = String(aa.phone || '').replace(/\D/g, '');
      const claim = String(aa.claim || aa.work_order || aa.wo || '').trim();
      const nm = String(aa.name || '').trim();
      const qp = claim ? `claim=${encodeURIComponent(claim)}` : (ph.length >= 10 ? `phone=${ph}` : (nm ? `name=${encodeURIComponent(nm)}` : ''));
      if (!qp) return say("No problem — what's the best phone number for you, and your name?");
      const jt = await fetch(`${SITE}/.netlify/functions/job-truth?${qp}&lens=customer`, { signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null);
      if (!jt || !jt.found) return say("I'm not finding you in our system yet — no worries, tell me what's going on with your appliance and I'll get you set up.", { found: false });
      const f = jt.facts || {};
      const first = f.customer_first || '';
      const appl = String(f.appliance || '').replace(/^appliance$/i, '');
      const day = f.scheduled_day || ''; const status = f.status || '';
      const bits = [];
      if (appl) bits.push(`your ${appl}`);
      if (day && !/cancel|complete/.test(status)) bits.push(`scheduled for ${day}`);
      else if (/await|part/.test(status)) bits.push(`waiting on the part`);
      const line = bits.length ? ` — I see ${bits.join(', ')}` : '';
      return say(`Got you${first ? `, ${first}` : ''}${line}. What can I help you with?`, { found: true, job_id: String(f.job_id || ''), caller_first: first });
    } catch (_) {
      return say("Let me take your name and number so I can pull you up.", { found: false });
    }
  }

  let body = {}; try { body = JSON.parse(rawBody(event) || '{}'); } catch (_) {}
  const a = argsOf(body);
  const jobId = Number(a.job_id || a.jobId || 0) || 0;

  try {
    // 1) THE PRIORITY — text the pre-diagnosis / intake link mid-call (feeds the chain).
    if (doAction === 'send_intake_link') {
      if (!jobId) return say("I couldn't find your job on file, so let me take your info and have the office text you that link.");
      const r = await post('send-intake-link', { job_id: jobId, force: true });
      return r && r.ok
        ? say("Perfect — I just texted you a link. Tap it, send a short video of the problem and a photo of the model sticker, and reply with the days that work. That's all we need to lock in your visit.")
        : say("I tried to text your link but it didn't go through — I'll have the office send it to you right away.", { sent: false });
    }

    // 2) Capture availability — days AND time-of-day — so we route right and never
    // show up at the wrong time. Fold the time-of-day into the saved availability.
    if (doAction === 'capture_availability') {
      const timeNotes = String(a.time_notes || a.times || '').trim();
      const availDays = String(a.available || a.availability_text || a.days || '').trim();
      const avail = [availDays, timeNotes].filter(Boolean).join(' — ');   // e.g. "Tue or Thu — afternoons only"
      const unavail = String(a.unavailable || a.unavailable_text || '').trim();
      const closer = `We'll route it the most efficient way around that and text you a live arrival window the morning of.`;
      if (!jobId) return say(`Got it — ${avail || 'those days'}${unavail ? `, and avoiding ${unavail}` : ''}. ${closer} Anything else I can help with?`);
      await post('save-availability', { job_id: jobId, availability_text: avail, unavailable_text: unavail });
      await post('set-job-availability', { job_id: jobId, available: avail, unavailable: unavail, actor: 'ann_phone' });
      return say(`Perfect — I've got you down for ${avail || 'those days'}${unavail ? `, avoiding ${unavail}` : ''}. ${closer} Anything else I can help with?`);
    }

    // 2a2) SELF-SCHEDULE HOLD — the customer says "just get me on the schedule." Ann puts a
    // TENTATIVE hold on the day they want (the customer has done their part), the office is
    // messaged to approve or adjust, and the customer gets a tentative confirmation. Closes
    // the loop on the call and saves a phone tag. (Teddy 2026-08-12.)
    if (doAction === 'place_hold') {
      const dayReq = String(a.day || a.date || a.available || '').trim();
      const timePref = String(a.time || a.time_pref || a.time_notes || '').trim();
      const resolved = resolveDayCT(dayReq);
      if (!jobId || !resolved) {
        // Fall back to just capturing what they want so nothing is lost.
        return say(`No problem — tell me the day that works and I'll get you tentatively on the schedule.`);
      }
      // Load name / appliance / phone / city / zip once so the office sees who + where.
      let name = 'there', appliance = '', to = '', city = '', zip = '';
      try {
        const d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(9000) }).then((r) => r.json());
        const cu = (d && d.customer) || {}; const jb = (d && d.job) || {};
        name = cu.first_name || name;
        appliance = String((d && d.appliance && (d.appliance.type || d.appliance.appliance_type)) || jb.appliance || '').replace(/^appliance$/i, '');
        to = String(cu.phone || jb.customer_phone || '').replace(/\D/g, '');
        city = String(cu.city || jb.service_city || jb.city || '').trim();
        zip = String(cu.zip || cu.zip_code || jb.service_zip || jb.zip || '').trim();
      } catch (_) {}
      // 1) File the CUSTOMER SCHEDULING REQUEST (by:customer) — shows on the office board.
      await post('schedule-hold', { action: 'hold', job_id: jobId, date: resolved.date, customer: name, appliance, by: 'customer', time_pref: timePref, city, zip, phone: to });
      const whenSpoken = `${resolved.label}${timePref ? `, ${timePref}` : ''}`;
      // 2) Message the office — a CUSTOMER SCHEDULING REQUEST to approve, or call the
      // customer back to adjust if the route can't make that day (Teddy 2026-08-12).
      if (sendSms) {
        const tile = `${SITE}/office-board.html?job=${jobId}`;
        const line = `📋 CUSTOMER SCHEDULING REQUEST — ${name}${appliance ? ` · ${appliance}` : ''} wants ${whenSpoken}. Approve, or call them back to adjust → ${tile}`.slice(0, 320);
        try { await sendSms('+16154850713', line, 'danielle', 'customer_schedule_request'); } catch (_) {}   // Danielle (scheduler)
        try { await sendSms('+16292594602', line, 'office', 'customer_schedule_request'); } catch (_) {}      // Sofia (scheduler)
      }
      // 3) Text the customer a tentative confirmation + the office-callback promise.
      if (to && to.length >= 10 && sendSms) {
        const last4 = to.slice(-4);
        const portal = `${SITE}/customer-portal.html?job_id=${jobId}&last4=${last4}`;
        const cmsg = `Hi ${name} — we've got your scheduling request in for ${whenSpoken}. Our office will confirm it shortly; if our route can't make that day, we'll call you right back to find one that works. Need to change it? ${portal}  — TN Appliance Exchange 🐜`;
        try { await sendSms(to, cmsg, 'customer', 'customer_schedule_request'); } catch (_) {}
      }
      return say(`Perfect — I've got your scheduling request in for ${whenSpoken}. Our office will confirm it, and if our route can't make that exact day they'll call you right back to find one that works. You've done your part — you're all set. Anything else I can help with?`);
    }

    // 2b) Send JUST the waiver link (when the service waiver isn't signed yet).
    if (doAction === 'send_waiver_link') {
      if (!jobId) return say("Let me have the office text you the waiver link.");
      let to = '', name = 'there';
      try {
        const d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(9000) }).then((r) => r.json());
        to = String((d && d.customer && d.customer.phone) || (d && d.job && d.job.customer_phone) || '').replace(/\D/g, '');
        name = (d && d.customer && d.customer.first_name) || name;
      } catch (_) {}
      if (!to || to.length < 10 || !sendSms) return say("I'll have the office get that waiver to you right away.", { sent: false });
      const link = `${SITE}/waiver.html?job_id=${jobId}`;
      const msg = `Hi ${name} — one quick step before your TN Appliance Exchange visit: please sign your service waiver here (takes about 20 seconds): ${link}`;
      const sent = await sendSms(to, msg, 'customer', 'waiver_link');
      return sent
        ? say("Perfect — I just texted you the waiver link. It's quick, just tap it and sign, and you're all set for your visit.")
        : say("I had trouble texting the waiver just now — the office will make sure you get it.", { sent: false });
    }

    // 3) Send the durable pay link mid-call.
    if (doAction === 'send_pay_link') {
      if (!jobId) return say("Let me have the office send your payment link so you've got it handy.");
      const r = await post('send-pay-link', { job_id: jobId });
      return r && r.ok
        ? say("Done — I just texted you a secure payment link. You can pay right from your phone whenever you're ready.")
        : say("I had trouble sending the payment link — the office will get that to you shortly.", { sent: false });
    }

    // 4) Never drop a caller — capture a callback (reuses the office callback queue).
    if (doAction === 'capture_callback') {
      const r = await post('capture-callback', {
        name: String(a.name || '').trim(), phone: String(a.phone || '').trim(),
        summary: String(a.summary || a.reason || '').trim(), caller_type: String(a.caller_type || 'customer').trim(), ref: 'ann_phone',
      });
      return say((r && r.say) || "You're all set — I've logged your callback and the office will reach out shortly. Anything else I can do?");
    }

    // 4b) ALERT THE OFFICE — pop the caller onto the office's phones/laptops with a one-tap
    // link straight to their tile (Teddy 2026-08-12: "she gets a text with a quick brief,
    // taps it, the tile opens on her cell"). Ann calls this the moment a human is needed —
    // a caller asking for a person, or a warranty rep who gave a work-order number.
    if (doAction === 'alert_office') {
      const claim = String(a.claim || a.work_order || a.wo || '').trim();
      const noteTxt = String(a.note || a.reason || a.summary || '').trim().slice(0, 120);
      const qs = claim ? `claim=${encodeURIComponent(claim)}` : (jobId ? `job_id=${jobId}` : '');
      const open = officeOpenCT();
      if (!qs) return say("Let me grab your info so I can get the right person to you.", { office_open: open });
      // Pop the caller's whole story onto the office's screens (this IS the brief — the
      // human sees who's on the line + why before they even answer).
      const r = await fetch(`${SITE}/.netlify/functions/caller-pop?${qs}${noteTxt ? `&note=${encodeURIComponent(noteTxt)}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}), signal: AbortSignal.timeout(9000) }).then((x) => x.json()).catch(() => null);
      const alerted = !!(r && r.ok);
      // Tell Ann whether to CONNECT (office open) or take a message (closed). She reads
      // office_open and follows the warm-transfer flow in her instructions.
      if (open) {
        return say(alerted
          ? "Perfect — I've pulled your whole call up on the office's screen so they can see exactly what's going on. Let me connect you now, one moment."
          : "Let me connect you to the office now — one moment.", { office_open: true, alerted });
      }
      return say("I've made sure the office has your details for first thing — since we're outside office hours right now, let me take down anything you need so they jump right on it when they're back.", { office_open: false, alerted });
    }

    // 5) NEVER LOSE A CALL — authoritative outcome write + office alert on urgent/warranty.
    if (doAction === 'log_outcome') {
      const summary = String(a.summary || a.notes || '').trim().slice(0, 600);
      const urgent = a.urgent === true || a.urgent === 'true';
      const warranty = a.warranty === true || a.warranty === 'true';
      const needsOffice = urgent || warranty || a.needs_office === true || a.needs_office === 'true';
      try { await crud.logEvent('call_outcome', { job_id: jobId || 0, summary, urgent, warranty, needs_office: needsOffice, source: 'ann_phone', at_ms: Date.now() }); } catch (_) {}
      if (needsOffice && sendSms) {
        const tag = urgent ? '🚨 URGENT' : (warranty ? '📋 WARRANTY' : '📞 FOLLOW-UP');
        const line = `${tag} call${jobId ? ' · job #' + jobId : ''}: ${summary || 'see call'}`.slice(0, 300);
        try { await sendSms('+16154855795', line, 'owner', 'call_outcome_alert'); } catch (_) {}      // Teddy
        try { await sendSms('+16154850713', line, 'danielle', 'call_outcome_alert'); } catch (_) {}    // Danielle
      }
      return say('Noted.');
    }

    return json(200, { ok: false, result: "I'm not sure how to help with that yet — let me take a note for the office." });
  } catch (e) {
    return json(200, { ok: false, result: "Something hiccupped on my end — I'll log this so the office can follow up.", error: String((e && e.message) || e) });
  }
};
