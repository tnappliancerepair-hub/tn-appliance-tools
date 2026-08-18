// office-texml — TeXML that rings the office when a caller is transferred to a human.
//
// PRIORITY (Teddy 2026-08-03): ring the DISPATCHERS (Danielle + Sofia) first, then
// fall back to TEDDY. Two ways to be reached, independent:
//   • CELL   — gated by OFFICE_REACH_<NAME> ("off" = don't ring my cell).
//   • COMPUTER APP (office-phone.html WebRTC) — rings whenever that person is On in
//     the app (registered on the "Ant office phone" credential connection). Reached
//     by dialing sip:<sip_username>@sip.telnyx.com. Not gated by the reach flag, so
//     e.g. Sofia can take calls on her computer with her CELL turned off. If the app
//     isn't On, that SIP leg just doesn't answer — harmless.
// One <Dial> mixes <Number> (cells) + <Sip> (apps); they ring in parallel, first to
// answer wins. Leg 1 rings the dispatchers with an action webhook (?leg=2); if none
// answer, leg 2 rings Teddy.
//
// SAFETY: the computer-app (SIP) legs are behind OFFICE_PHONE_WEBRTC_INBOUND — set it
// to "off" to instantly revert to the known-good cell-only ring.
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const SELF = 'https://tnapplianceexchange.net/.netlify/functions/office-texml';
function esc(s) { return String(s || '').replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c])); }
function isOff(v) { return String(v || '').trim().toLowerCase() === 'off'; }
function sipUri(username) { const u = String(username || '').trim(); return u ? `sip:${u}@sip.telnyx.com` : ''; }
function xmlResp(inner) {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n' + inner + '\n</Response>';
  return { statusCode: 200, headers: { 'content-type': 'text/xml; charset=utf-8' }, body: xml };
}
// legs: array of { number } (cell) or { sip } (computer app). Rings all in parallel.
// whisperUrl (optional): a "press 1 to accept" TeXML played to the CALLEE cell before
// the legs bridge — a screener/voicemail can't silently swallow the call. SIP app legs
// are left un-whispered (they answer as a real human on the softphone).
function dialLegs(legs, callerId, timeout, actionUrl, whisperUrl) {
  const action = actionUrl ? ` action="${esc(actionUrl)}" method="POST"` : '';
  const wu = whisperUrl ? ` url="${esc(whisperUrl)}"` : '';
  const inner = legs
    .map((l) => (l.sip ? `    <Sip>${esc(l.sip)}</Sip>` : `    <Number${wu}>${esc(l.number)}</Number>`))
    .join('\n');
  return `  <Dial callerId="${esc(callerId)}" timeout="${timeout}" answerOnBridge="true"${action}>\n${inner}\n  </Dial>`;
}
// Telnyx posts the action webhook form-encoded; pull one field out of the body.
function formField(event, name) {
  try {
    const body = event && event.body ? event.body : '';
    const re = new RegExp('(?:^|&)' + name + '=([^&]*)', 'i');
    const m = re.exec(body);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  } catch (_) { return ''; }
}
function dialStatus(event) { return String(formField(event, 'DialCallStatus')).toLowerCase(); }

// PHONE-TRANSFER-OUTCOME LOGGING (Teddy 2026-08-06). Pure measurement, additive —
// records who answered vs missed each transferred call so we can answer "are the
// humans answering the phones?" and attribute call-catching to Sofia/Danielle/Teddy.
// Wrapped in a short race so a slow Xano can NEVER delay the caller's next ring
// (crud.logEvent already has its own retry/timeout; this is the hard on-call cap).
function raceLog(action, metadata, capMs) {
  const cap = capMs || 1200;
  return Promise.race([
    crud.logEvent(action, metadata),
    new Promise((r) => setTimeout(r, cap)),
  ]).catch(() => null);
}
async function logTransferOutcome({ tier, answered, status, event, leg }) {
  if (!tier) return;
  await raceLog('phone_transfer_outcome', {
    outcome: answered ? 'answered' : 'missed',
    answered_by: answered ? tier.name : '',
    missed_by: answered ? '' : tier.name,
    tier: tier.name,
    tier_index: (leg - 2),
    dial_status: status || '',
    caller: formField(event, 'From') || '',
    to: formField(event, 'To') || '',       // the LINE the call rode in on (a DID), NOT the dialed cell
    dialed: (tier && tier.cell) || '',       // the actual number we RANG for this tier (the cell)
    call_sid: formField(event, 'CallSid') || '',
    leg,
    at_ms: Date.now(),
  });
}

exports.handler = async function (event) {
  const qs = (event && event.queryStringParameters) || {};

  // ── "PRESS 1 TO ACCEPT" WHISPER (Teddy 2026-08-18) ────────────────────────────
  // The fix for calls getting silently swallowed: a call-screener, voicemail, or auto-
  // attendant answering the transfer used to read as "answered" and STOP the cascade,
  // stranding the caller and never ringing the next person. Now each dialed cell gets a
  // whisper played to the CALLEE ONLY, before the legs bridge — they must press 1 to
  // take the call. No press (screener / VM / decline) => the leg drops and the cascade
  // rings the next dispatcher. The caller hears only ringback the whole time
  // (answerOnBridge). These two branches need NO secrets, so they return immediately
  // and never touch the heavy secret load below.
  if (qs.whisper === '1') {
    const g = (p) => `  <Gather input="dtmf" numDigits="1" timeout="6" action="${esc(SELF)}?wconfirm=1" method="POST">\n    <Say>${esc(p)}</Say>\n  </Gather>`;
    return xmlResp(
      '  <Pause length="1"/>\n' +
      g('T N Appliance call. Press 1 to take this call.') + '\n' +
      g('Press 1 to take the call, or hang up.') + '\n' +
      '  <Hangup/>'
    );
  }
  if (qs.wconfirm === '1') {
    // Digit came back from the whisper Gather. 1 = accept -> the callee script ends and
    // the legs bridge. Anything else (or a machine that never pressed) -> hang up this
    // leg so the Dial falls through to the next person.
    return String(formField(event, 'Digits') || '').trim() === '1' ? xmlResp('  <Pause length="1"/>') : xmlResp('  <Hangup/>');
  }

  // Load EVERY secret CONCURRENTLY. This runs on the LIVE transfer path; reading
  // these serially (12 awaits) meant a slow/hung metadata API could stack ~12×
  // its per-read timeout of wall-time before Telnyx received any <Response> — the
  // #1 dead-air SPOF on the human handoff. Firing them together caps the whole
  // secret-load at ~one timeout, and every value has a hardcoded fail-safe default
  // below so an empty/timed-out read still produces a valid ring (never dead air).
  const g = (n) => getSecret(n).catch(() => '');
  const gf = (n) => getSecretFresh(n).catch(() => '');
  const [
    callerIdRaw, webrtcRaw,
    cellSofia, reachSofia, sipSofiaU,
    cellDanielle, reachDanielle, sipDanielleU,
    cellTeddy, reachTeddy, sipTeddyU, sipTeddyLegacyU,
    ringRaw, confirmRaw,
  ] = await Promise.all([
    g('TELNYX_OFFICE_CALLER_NUMBER'), gf('OFFICE_PHONE_WEBRTC_INBOUND'),
    g('OFFICE_CELL_SOFIA'), gf('OFFICE_REACH_SOFIA'), g('TELNYX_SIP_USERNAME_SOFIA'),
    g('OFFICE_CELL_DANIELLE'), gf('OFFICE_REACH_DANIELLE'), g('TELNYX_SIP_USERNAME_DANIELLE'),
    g('OFFICE_CELL_TEDDY'), gf('OFFICE_REACH_TEDDY'), g('TELNYX_SIP_USERNAME_TEDDY'), g('TELNYX_SIP_USERNAME'),
    g('OFFICE_RING_SECONDS'), gf('TRANSFER_CONFIRM'),
  ]);

  // "Press 1 to accept" is ON by default. Flip TRANSFER_CONFIRM=off in the vault to
  // instantly revert to a plain ring (no whisper) — no redeploy. When on, each dialed
  // cell gets the whisper and the cascade only counts a call as answered once it has
  // truly BRIDGED (a screener/VM auto-answer never bridges, so it falls through).
  const confirmOn = String(confirmRaw || '').trim().toLowerCase() !== 'off';
  const whisperUrl = confirmOn ? `${SELF}?whisper=1` : '';

  const callerId = callerIdRaw || '+16155889591';
  // Computer-app (WebRTC) legs: OPT-IN, default OFF (Teddy 2026-08-17). The softphone
  // SIP legs were returning an instant "busy" and poisoning the whole transfer —
  // callers dropped even though the person's CELL was free. Proven in the transfer
  // log: every failure dialed a sip: leg that went busy, every success dialed a CELL
  // (Sofia even answers on her cell, not the app). So ring CELLS ONLY unless the app
  // is explicitly re-enabled with OFFICE_PHONE_WEBRTC_INBOUND=on.
  const webrtcOn = String(webrtcRaw || '').trim().toLowerCase() === 'on';

  // PRIORITY (Teddy 2026-08-04): Sofia FIRST, Danielle SECOND, Teddy last-resort.
  // DISPATCHERS ALWAYS REACHABLE (Teddy 2026-08-17): Sofia + Danielle's CELLS always
  // ring on a transfer — no OFFICE_REACH on/off switch to forget. Danielle's calls were
  // silently dropping because her reach switch was left "off", so her cell was never
  // dialed (only her app leg, which returns busy). Their cells now always dial + their
  // computer app too (if their SIP login is vaulted). Teddy's tier still honors his own
  // OFFICE_REACH_TEDDY gate. A tier that doesn't answer in ~30s chains to the next.
  // A dispatcher's cell must be their REAL mobile, never one of the shop's own DIDs.
  // OFFICE_CELL_DANIELLE had been mis-set to the warranty-desk line (+16157575500),
  // so the warranty cascade dialed that DID *as* "Danielle" → it rang a line nobody
  // sits at, forever, and she never got the call. Guard: if a configured cell is a
  // shop DID (or blank), fall back to the person's known mobile. (Teddy 2026-08-17.)
  // Danielle stopped getting ANY shop calls the day "Sofia was added" — the OFFICE_CELL_*
  // values got shuffled/mis-set in the vault (Danielle's got pointed at the wrong number),
  // so her tier dialed the wrong phone while Sofia's worked. Hard-set the two dispatchers
  // to their CONFIRMED mobiles (Teddy 2026-08-17) so no bad vault value can misroute them.
  // Teddy keeps vault+fallback (+ his reach gate). Shop DIDs guarded for all.
  const SHOP_DIDS = ['+16157575500', '+16155889591', '+16155889500', '+16158578800', '+16158211400', '+16152802949', '+18662680111', '+18882688998', '+16292607111', '+16292477111', '+15043701234', '+17315031142'];
  const realCell = (v, fallback) => { const c = String(v || '').replace(/[^\d+]/g, ''); return (c && c.startsWith('+') && !SHOP_DIDS.includes(c)) ? c : fallback; };
  const SOFIA =    { name: 'Sofia',    cell: '+16292594602', on: true, sip: webrtcOn ? sipUri(sipSofiaU) : '' };
  const DANIELLE = { name: 'Danielle', cell: '+16154850713', on: true, sip: webrtcOn ? sipUri(sipDanielleU) : '' };
  const TEDDY =    { name: 'Teddy',    cell: realCell(cellTeddy, '+16154855795'),    on: !isOff(reachTeddy),    sip: webrtcOn ? sipUri(sipTeddyU || sipTeddyLegacyU) : '' };
  // ORDER (Teddy 2026-08-13): warranty-company reps go to DANIELLE first, then Sofia, then
  // Teddy — she handles warranty check-ups fastest. Everyone else keeps the Sofia-first
  // order. Set by the "Warranty Desk" TeXML app whose voice_url carries ?order=warranty.
  const order = String(((event && event.queryStringParameters) || {}).order || '').toLowerCase();
  const warrantyFirst = order === 'warranty' || order === 'danielle';
  // WHO RINGS — SEQUENTIAL, one at a time (Teddy 2026-08-18, exact spec: "ring Sofia
  // first unless it's a warranty company; if she doesn't answer send to the other; then
  // offer to take a message and text it to the office").
  //   default (homeowner)  -> Sofia, then Danielle
  //   warranty rep         -> Danielle first (she runs the warranty desk), then Sofia
  // The owner is NOT in the cascade (delegation — Teddy off the ring). If BOTH dispatchers
  // miss, the dial ends and Ann resumes to take a message + text the office. Each group
  // holds ONE person so they ring in turn. orderQS carries the warranty flag through legs.
  const groups = warrantyFirst ? [[DANIELLE], [SOFIA]] : [[SOFIA], [DANIELLE]];
  const orderQS = warrantyFirst ? `order=${order}&` : '';
  // CELLS ONLY (Teddy 2026-08-17): the softphone/app (SIP) legs returned an instant
  // "busy" that both dropped the caller AND made Ann bail after one ring ("looks like
  // they stepped away"). The transfer log proved cells connect and sip legs fail, so
  // the transfer cascade dials CELLS ONLY — the app legs are removed regardless of
  // OFFICE_PHONE_WEBRTC_INBOUND. (webrtcOn/sip kept computed above for any other use.)
  const legsFor = (grp) => grp.filter((t) => t && t.on && t.cell).map((t) => ({ number: t.cell }));
  // A group's log identity = the reachable members' names + cells (for phone_transfer_outcome).
  const groupTier = (grp) => { const m = grp.filter((t) => t && t.on && t.cell); return { name: m.map((t) => t.name).join('/'), cell: m.map((t) => t.cell).join(',') }; };

  // Ring length (seconds) per group. A 20s timeout was too short once the carrier's
  // call-setup delay (5–10s before the phone audibly rings) is subtracted. Give each ~30s
  // (≈5 rings). Vault-tunable via OFFICE_RING_SECONDS (clamped 15–45), no redeploy needed.
  let ringSecs = parseInt(ringRaw, 10);
  if (!(ringSecs >= 15 && ringSecs <= 45)) ringSecs = 30;

  let leg = parseInt(qs.leg, 10);
  if (!(leg >= 1)) leg = 1;

  // A prior GROUP's ring already reported back. The action was set to ?leg=<i+2> for the
  // group at index i, so the group just rung = groups[leg-2]. Log answered/missed
  // (measurement only — never changes the ring behavior below).
  if (leg > 1) {
    const st = dialStatus(event);
    // With press-1 confirm on (cfm=1), a screener/voicemail that auto-answers reports
    // "completed"/"answered" but NEVER bridges (DialCallDuration 0). Count only a truly
    // BRIDGED call (dur > 0) as answered, so an auto-answer falls through to the next
    // person instead of stranding the caller. Without confirm, status alone (unchanged).
    const cfm = String(qs.cfm || '') === '1';
    const dur = parseInt(formField(event, 'DialCallDuration'), 10) || 0;
    const statusOK = st === 'completed' || st === 'answered' || st === 'bridged';
    const answered = cfm ? (statusOK && dur > 0) : statusOK;
    const rung = groups[leg - 2];
    if (rung) await logTransferOutcome({ tier: groupTier(rung), answered, status: st, event, leg });
    if (answered) return xmlResp('  <Hangup/>');
  }

  // Ring the first reachable GROUP at or after `leg` (ALL its cells in parallel); chain to
  // the next group if nobody in this one answers.
  for (let i = leg - 1; i < groups.length; i++) {
    const legs = legsFor(groups[i]);
    if (!legs.length) continue;
    const moreAhead = groups.slice(i + 1).some((g) => legsFor(g).length);
    // ALWAYS attach an action — even on the FINAL group — so its answer/miss gets logged.
    // Previously the last tier had action=null, so when the last person answered, no
    // callback fired and their catch was never recorded (undercounting the log, e.g. Sofia
    // answering as the last ring showed 0). The action fires when the dial ends (post-bridge
    // for an answered call); the follow-up leg finds no further group and Rejects a call
    // that's already over — harmless — after logging the outcome. (Teddy 2026-08-18)
    const action = `${SELF}?${orderQS}${confirmOn ? 'cfm=1&' : ''}leg=${i + 2}`;
    // Final reachable group gets a slightly longer ring (last chance before it falls through).
    return xmlResp(dialLegs(legs, callerId, moreAhead ? ringSecs : Math.min(ringSecs + 5, 45), action, whisperUrl));
  }
  return xmlResp('  <Reject/>');
};
