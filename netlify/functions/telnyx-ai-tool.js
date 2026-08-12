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
function post(path, payload, ms = 12000) {
  return fetch(`${SITE}/.netlify/functions/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(ms) }).then((r) => r.json()).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
}
// A tool reply: `result` is what the assistant SAYS; keep it short + spoken-natural.
const say = (result, extra) => json(200, { ok: true, result, ...(extra || {}) });

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  const doAction = String(q.do || q.action || '').toLowerCase();

  // Optional shared-token gate (fast, no vault round-trip). If TELNYX_TOOL_SECRET is
  // set we require ?k=, else we allow (shadow-pilot friendly). Harden before go-live.
  const need = process.env.TELNYX_TOOL_SECRET || '';
  if (need && q.k !== need && doAction !== 'ping') return json(200, { ok: false, result: "Sorry, I hit a snag on my end — let me take a note and have the office follow up." });

  if (doAction === 'ping') return say('pong', { ts: Date.now() });

  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
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
      if (!qs) return say("Let me grab your info so I can get the right person to you.");
      const r = await fetch(`${SITE}/.netlify/functions/caller-pop?${qs}${noteTxt ? `&note=${encodeURIComponent(noteTxt)}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}), signal: AbortSignal.timeout(9000) }).then((x) => x.json()).catch(() => null);
      return r && r.ok
        ? say("Perfect — I've pulled everything up for the office and let them know you're on the line. Hang tight one moment.")
        : say("Let me take down what you need so the office can jump right on it.", { alerted: false });
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
