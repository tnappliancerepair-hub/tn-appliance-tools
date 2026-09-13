// google-line-texml — the dedicated Google-Ads line (615-845-8500). Teddy wants to
// personally take the paid leads: RING HIS CELL FIRST (~25s, real ringback, no AI
// greeting in front), and if he can't grab it, HAND THE CALLER TO ANN so the paid
// click is never lost — plus text Teddy the caller's number to ring back. Option A
// from 2026-08-21: "you first, Ann backs you up."
//
// Wired by telnyx-provision?action=googleline (points the 845-8500 DID at this TeXML).
//
// EVERY CALL HERE IS A PAID GOOGLE-ADS LEAD - that is the whole point of a dedicated
// number - and until 2026-09-13 not one of them was written down. Measured: $845 of
// spend over 30 days, 225 clicks, 8 calls Google says it drove, and zero way to tell
// whether any became a job. Google's own `Ant - Booked Job` action read 0 because
// nothing ever fed it. So log the caller + the moment they rang: that pair
// (caller_id + call_start_date_time) is exactly what Google's call-conversion upload
// takes, so a call that turns into a job can be sent back as a real conversion.
// Best-effort and time-boxed - the log can never delay or break a live call.
'use strict';

const { sendSms } = require('./_lib/sms');
let crud = null; try { crud = require('./_lib/xano/metadata-crud'); } catch (_) {}
const SELF = 'https://tnapplianceexchange.net/.netlify/functions/google-line-texml';
const TEDDY_CELL = '+16154855795';   // rings first
const ANN_DID = '+16152802949';      // reaches Ann (the fallback answer point)
const SHOP_CALLER_ID = '+16152802949';
const RING_SECS = 25;

function xml(inner) {
  return { statusCode: 200, headers: { 'Content-Type': 'text/xml' }, body: `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${inner}\n</Response>` };
}
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function formField(event, name) {
  try { return new URLSearchParams(event.body || '').get(name) || ''; } catch (_) { return ''; }
}
// A valid US caller number we can show on Teddy's screen (so he sees the customer,
// not a generic shop line). Falls back to the shop number if the From looks odd.
function callerFrom(raw) {
  const d = String(raw || '').replace(/[^\d+]/g, '');
  if (/^\+1\d{10}$/.test(d)) return d;
  if (/^1\d{10}$/.test(d)) return `+${d}`;
  if (/^\d{10}$/.test(d)) return `+1${d}`;
  return SHOP_CALLER_ID;
}

// Best-effort text to Teddy on a miss — 'owner' role bypasses the intake gate/caps.
// Never blocks the call flow (wrapped + raced by the caller).
async function textTeddyMiss(from) {
  try {
    await sendSms(TEDDY_CELL, `📞 Missed a GOOGLE-ADS lead on 845-8500 from ${from || 'unknown'} — Ann is handling it, call them back.`, 'owner', 'google_line_miss');
  } catch (_) {}
}

// Write the paid lead down. Never throws, never blocks (the caller races it).
async function logPaidCall(from, extra) {
  if (!crud) return;
  try {
    await crud.logEvent('google_ads_call', {
      from: callerFrom(from), line: '6158458500', source: 'google_ads',
      at_ms: Date.now(), at_iso: new Date().toISOString(), ...(extra || {}),
    });
  } catch (_) {}
}

exports.handler = async function (event) {
  const qs = event.queryStringParameters || {};
  const leg = parseInt(qs.leg, 10) || 1;
  const from = formField(event, 'From') || qs.from || '';

  // DIRECT / VERIFY mode: ring Teddy's cell ONLY (45s), no Ann fallback. Used to catch a
  // Google number-verification/approval call so an AI never answers it. Reverted to Ann
  // once the number is approved. No customer traffic on a paused campaign's number.
  if (qs.direct === '1') {
    if (leg >= 2) return xml('  <Hangup/>');
    const action = `${SELF}?direct=1&leg=2`;
    return xml(`  <Dial answerOnBridge="true" timeout="45" callerId="${esc(callerFrom(from))}" action="${esc(action)}" method="POST"><Number>${esc(TEDDY_CELL)}</Number></Dial>`);
  }

  // Leg 2: Teddy's cell ring reported back. Answered -> done. Missed -> hand to Ann + text.
  if (leg >= 2) {
    const st = String(formField(event, 'DialCallStatus') || '').toLowerCase();
    const dur = parseInt(formField(event, 'DialCallDuration'), 10) || 0;
    const answered = (st === 'completed' || st === 'answered') && dur > 0;
    // Outcome matters for the upload: Google's call conversion wants a real conversation,
    // not a ring-out. Duration is what separates a lead from a misdial.
    await Promise.race([logPaidCall(from, { leg: 2, stage: answered ? 'owner_answered' : 'handed_to_ann', answered, duration_s: dur, dial_status: st }), new Promise((r) => setTimeout(r, 900))]);
    if (answered) return xml('  <Hangup/>');
    await Promise.race([textTeddyMiss(from), new Promise((r) => setTimeout(r, 1600))]);
    // Bridge the caller to Ann (inbound to 280-2949 = Ann answers). The text above is the
    // backstop if this bridge ever hiccups — Teddy still gets the number to call back.
    return xml(`  <Dial answerOnBridge="true" callerId="${esc(SHOP_CALLER_ID)}"><Number>${esc(ANN_DID)}</Number></Dial>`);
  }

  // Leg 1: ring Teddy's cell first. answerOnBridge => caller hears ringback, no AI in front.
  // Record the lead the instant it lands, BEFORE any ringing - a caller who hangs up during
  // ringback is still a click we paid for and still worth calling back.
  await Promise.race([logPaidCall(from, { leg: 1, stage: 'ringing_owner' }), new Promise((r) => setTimeout(r, 900))]);
  const action = `${SELF}?leg=2&from=${encodeURIComponent(from)}`;
  return xml(`  <Dial answerOnBridge="true" timeout="${RING_SECS}" callerId="${esc(callerFrom(from))}" action="${esc(action)}" method="POST"><Number>${esc(TEDDY_CELL)}</Number></Dial>`);
};
