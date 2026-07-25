// verify-quickcheck — called by the thank-you page after Stripe redirect.
// Verifies the $50 actually cleared, then (idempotently) creates the cash job,
// records the payment, and fires the 💵 CASH siren to Teddy + Danielle.
//
//   POST { session_id }  ->  { ok, paid, job_id, first_name }

'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const { resolveAreaTech, sendAreaTechTeddyTool, bossSirenNote } = require('./_lib/area-tech-notify');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const OWNER = '+16154855795';     // Teddy
const DANIELLE = '+16154850713';

function rowMeta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function stateFromZip(zip) { const z = String(zip || '').replace(/\D/g, '').slice(0, 5); if (/^7[01]/.test(z)) return 'LA'; if (/^3[78]/.test(z)) return 'TN'; return ''; }

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const sessionId = String(b.session_id || '').trim();
  if (!sessionId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'session_id required' }) };

  const key = await getSecret('STRIPE_SECRET_KEY');
  if (!key) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'payments not configured' }) };

  let session;
  try { session = await new Stripe(key).checkout.sessions.retrieve(sessionId); }
  catch (e) { return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'could not verify payment' }) }; }
  if (!session || session.payment_status !== 'paid') {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, paid: false, payment_status: (session && session.payment_status) || 'none', status: (session && session.status) || 'none' }) };
  }
  const m = session.metadata || {};
  const first = String(m.name || '').trim().split(/\s+/)[0] || '';
  // service: 'in_home' ($100 tech-comes-out) vs 'quick_check' ($50 phone). Both are
  // paid-before-scheduled self-pay jobs; only the labeling/wording differs.
  const service = String(m.service || m.kind || 'quick_check') === 'in_home' ? 'in_home' : 'quick_check';
  const amtPaid = Number(m.amount_cents || (service === 'in_home' ? 10000 : 5000)) / 100;
  const probPrefix = service === 'in_home'
    ? ('🏠 IN-HOME DIAGNOSTIC ($' + amtPaid + ' PAID, credited to repair) — ')
    : ('💵 QUICK CHECK ($' + amtPaid + ' PAID) — ');

  // idempotency — refresh of the thanks page must not create a 2nd job/charge record
  try {
    const prior = await crud.searchPage(crud.TABLES.event_log, { action: 'quick_check_paid' }, { created_at: 'desc' }, 200);
    const hit = (prior || []).find((r) => rowMeta(r).session_id === sessionId);
    if (hit) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, paid: true, already: true, job_id: rowMeta(hit).job_id, first_name: first }) };
  } catch (_) {}

  // create the cash job (lands in Needs Scheduled, flagged self_pay).
  // create_job_from_chat auto-links the orphan video + model-photo attachments
  // uploaded during the AI flow by their shared conversation_id.
  const nameParts = String(m.name || '').trim().split(/\s+/);
  const convId = parseInt(String(m.conv_id || '').replace(/\D/g, ''), 10) || null;
  let jobId = null, linkedAttachments = 0, photoLinked = false, videoLinked = false;
  try {
    const r = await fetch(`${XANO}/create_job_from_chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: nameParts[0] || 'Customer',
        last_name: nameParts.slice(1).join(' '),
        phone: m.phone || '',
        zip: m.zip || '',
        appliance_type: m.appliance || 'appliance',
        brand: m.brand || '',
        problem_summary: probPrefix + (m.problem || ''),
        customer_type: 'self_pay',
        recommended_service: service,
        channel: 'appliance_ai',
        sms_consent: m.sms_consent === 'yes',
        conversation_id: convId,
      }),
    });
    const d = await r.json().catch(() => ({}));
    jobId = (d && (d.id || d.job_id)) || null;
  } catch (_) {}

  // confirm how many attachments actually linked (diagnostic + truth in the log),
  // and auto-read the model sticker photo with Claude Vision so the job has the
  // model # + serial before Teddy ever opens it.
  if (jobId) {
    try {
      const ar = await fetch(`${XANO}/get_job_attachments?job_id=${jobId}`);
      const ad = await ar.json().catch(() => ({}));
      const atts = (ad && Array.isArray(ad.attachments)) ? ad.attachments : [];
      linkedAttachments = (ad && ad.count != null) ? ad.count : atts.length;
      videoLinked = atts.some((a) => a && (a.file_type === 'video' || (a.s3_key && String(a.s3_key).startsWith('cfstream:'))));
      photoLinked = atts.some((a) => a && a.file_type === 'photo' && !(a.s3_key && String(a.s3_key).startsWith('cfstream:')));
      // find the model-sticker photo (a real S3 image, not a Stream video)
      const photo = atts.find((a) => a && (a.file_type === 'photo' || (a.s3_key && !String(a.s3_key).startsWith('cfstream:') && /\.(jpe?g|png|heic|webp)$/i.test(a.s3_key))));
      if (photo && photo.s3_key) {
        const vr = await fetch(`${SITE}/.netlify/functions/s3-view-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s3_keys: [photo.s3_key] }) });
        const vd = await vr.json().catch(() => ({}));
        const viewUrl = (vd && vd.signed_urls && vd.signed_urls[0] && vd.signed_urls[0].view_url) || (vd && vd.view_url) || '';
        if (viewUrl) {
          // fire-and-forget OCR; writes model_number/serial to the job (only if empty)
          fetch(`${SITE}/.netlify/functions/ocr-model-extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, image_url: viewUrl, attachment_id: photo.id || null }) }).catch(() => {});
        }
      }
    } catch (_) {}
  }

  // create_job_from_chat only takes zip — set the full service address on the job row
  const lang = String(m.language || 'en').toLowerCase();
  const LANGNAME = { es: 'Spanish', vi: 'Vietnamese', ar: 'Arabic', hi: 'Hindi', fr: 'French' };
  if (jobId && (m.address || m.city || m.availability || m.floors_label || LANGNAME[lang])) {
    const pref = [m.availability || '', m.floors_label ? ('🛟 FLOORS: ' + m.floors_label) : '', LANGNAME[lang] ? ('⚑ Customer language: ' + LANGNAME[lang] + ' — reply in their language (Ant auto-translates).') : ''].filter(Boolean).join(' · ');
    try {
      await crud.update(crud.TABLES.jobs, jobId, {
        service_address: m.address || '',
        service_city: m.city || '',
        service_state: stateFromZip(m.zip),
        customer_preference_text: pref,
      });
    } catch (_) {}
  }

  // Flip the job row to PAID — the money is recorded in event_log (that's what
  // fired the siren), but the row field stayed "unpaid" and could confuse the
  // office. payment_collected (bool) is the reliable signal; payment_status:'paid'
  // is best-effort (no-ops if the enum lacks it). Teddy 2026-06-27.
  if (jobId) {
    try { await crud.update(crud.TABLES.jobs, jobId, { payment_status: 'paid', payment_collected: true, stripe_payment_reference: sessionId }); } catch (_) {}
  }

  // record the payment + the idempotency marker
  const amount = amtPaid;
  await crud.logEvent('quick_check_paid', { session_id: sessionId, job_id: jobId, service, conv_id: m.conv_id || '', linked_attachments: linkedAttachments, amount, name: m.name, phone: m.phone, email: m.email || '', machine: m.machine, town: m.town, sms_consent: m.sms_consent, language: lang, at_ms: Date.now() });
  await crud.logEvent('customer_payment_received', { job_id: jobId, amount, kind: service, session_id: sessionId, source: service, at_ms: Date.now() });
  // Web funnel: the 'paid' step — ties to the same conv_id as open/started/reached_pay.
  try { await crud.logEvent('web_funnel', { step: 'paid', conv_id: m.conv_id || '', appliance: m.appliance || m.machine || '', at_ms: Date.now() }); } catch (_) {}

  // 💵 PAID siren → Teddy + Danielle
  const link = jobId ? (`${SITE}/teddy-tdr-tool.html?job_id=${jobId}`) : `${SITE}/office-board.html`;
  const sirenHead = service === 'in_home' ? ('🏠💵 IN-HOME PAID — $' + amount) : ('💵💵 CASH QUICK-CHECK PAID — $' + amount);
  // Fresh strategy (Teddy 7/9): the Teddy Tool also goes to the zip's tech.
  const areaTech = await resolveAreaTech(m.zip || '');
  const areaNote = bossSirenNote(jobId, areaTech);
  const msg = sirenHead + ' · ' + (m.name || '(caller)') + ' · ' + (m.machine || 'appliance')
    + (m.town ? (' · ' + m.town) : '') + ' — ' + (m.problem || '').slice(0, 120)
    + '  Job #' + (jobId || '?') + ' → GET ON IT: ' + link + areaNote;
  try { await sendSms(OWNER, msg, 'owner', 'quick_check'); } catch (_) {}
  try { await sendSms(DANIELLE, msg, 'warranty_handler', 'quick_check'); } catch (_) {}
  if (jobId) { try { await sendAreaTechTeddyTool(areaTech, { link, customer: m.name, appliance: m.machine || 'appliance', city: m.town || m.city || '', jobId, kind: 'cash_qc' }); } catch (_) {} }

  // ── Never lose the media ──────────────────────────────────────────────────
  // If the video/photo didn't land (low signal that never recovered before the
  // Stripe redirect), flag the job and text the customer a one-tap link to finish
  // the upload from wherever they have signal — it links back by the same job.
  const yes = (v) => String(v) === 'yes' || String(v) === 'true';
  const expectedVideo = yes(m.has_video), expectedPhoto = yes(m.has_model);
  const videoMissing = expectedVideo && !videoLinked;
  const photoMissing = expectedPhoto && !photoLinked;
  let customerTexted = false;
  if (jobId && (videoMissing || photoMissing)) {
    try { await crud.update(crud.TABLES.jobs, jobId, { media_status: 'pending' }); } catch (_) {}
    await crud.logEvent('quick_check_media_pending', { job_id: jobId, conv_id: m.conv_id || '', phone: m.phone, video_missing: videoMissing, photo_missing: photoMissing, at_ms: Date.now() });
    if (yes(m.sms_consent) && m.phone) {
      const finishLink = `${SITE}/finish-upload.html?job_id=${jobId}`;
      const what = (videoMissing && photoMissing) ? 'your video + model photo' : (videoMissing ? 'your video' : 'the model-number photo');
      const cmsg = 'TN Appliance: got your $' + amount + ' Quick Check! It looks like ' + what + ' didn\'t fully upload on the last signal. Tap to finish so we can diagnose it fast: ' + finishLink + '  (Reply STOP to opt out.)';
      try { await sendSms(m.phone, cmsg, 'customer', 'quick_check_media'); customerTexted = true; } catch (_) {}
    }
  }

  // Confirm the $ landed + point them to the next step. PAY-FIRST flow: no video
  // yet, so the generic "got your video" ack would be wrong here — the real
  // "we got everything" confirmation fires later when they finish availability
  // (save-availability.js). If availability already came with the payment (the
  // in-home path collects it), send the fuller scheduled-ack instead. Skipped if
  // we already texted a finish-upload link above (no double-text). Guarded:
  // opt-out / dedup still enforced; allowQuiet because it's a transactional
  // response to a payment the customer just made.
  if (jobId && !customerTexted && yes(m.sms_consent) && m.phone) {
    if (String(m.availability || '').trim()) {
      try { await require('./_lib/intake-ack').sendIntakeAck({ job_id: jobId, phone: m.phone, name: m.name, appliance: m.appliance, availability: m.availability, consent: m.sms_consent, suppressed: false }); } catch (_) {}
    } else {
      const who = String(m.name || '').trim().split(/\s+/)[0] || 'there';
      const appl = String(m.appliance || m.machine || 'appliance').toLowerCase();
      const pmsg = 'Hi ' + who + ", it's TN Appliance — got your $" + amount + ' Quick Check ✅. Next: send a quick video of your ' + appl + " + a photo of the model-number sticker (the link's on your screen, or just reply here). A real tech gives you an honest answer within a couple hours. Thank you!";
      try { await require('./_lib/sms-guard').guardedSend({ phone: m.phone, message: pmsg, tag: 'quick_check_intake', kind: 'quick_check_intake', allowQuiet: true }); } catch (_) {}
    }
  }

  // Record the line/hose safety-offer decision (Teddy 2026-06-27). The recorded
  // choice — especially a DECLINE — is the liability protection; a YES tells the
  // office to bring + install it. Applies across the board (cash + warranty).
  const hoseChoice = String(m.hose_choice || '').toLowerCase();
  const hoseItem = String(m.hose_item || '').trim();
  if (jobId && (hoseChoice === 'yes' || hoseChoice === 'no') && hoseItem) {
    try { await crud.logEvent('line_offer_decision', { job_id: jobId, item: hoseItem, choice: hoseChoice, source: 'intake', at_ms: Date.now() }); } catch (_) {}
    if (hoseChoice === 'yes') {
      const hmsg = '🔧 ' + hoseItem.toUpperCase() + ' ADD-ON: ' + (m.name || 'customer') + ' said YES at intake on job #' + jobId + ' — bring + install + add to the ticket.';
      try { await sendSms(DANIELLE, hmsg, 'warranty_handler', 'hose_addon_request'); } catch (_) {}
    }
  }

  // FLOORS flag (Teddy 2026-06-27): tech must show up prepared — no blind visit.
  // air_sled → route a sled + add $125; logged either way; the banner rides
  // customer_preference_text to the tech's dashboard.
  const floorsChoice = String(m.floors || '').toLowerCase();
  if (jobId && floorsChoice && floorsChoice !== 'standard') {
    try { await crud.logEvent('floors_flag', { job_id: jobId, choice: floorsChoice, label: String(m.floors_label || ''), at_ms: Date.now() }); } catch (_) {}
    if (floorsChoice === 'air_sled') {
      const fmsg = '🛟 AIR-SLED ($125) requested on job #' + jobId + ' (' + (m.name || 'customer') + ') — route a sled-equipped tech + add $125 to the ticket.';
      try { await sendSms(DANIELLE, fmsg, 'warranty_handler', 'air_sled_request'); } catch (_) {}
    }
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, paid: true, job_id: jobId, first_name: first, media_linked: linkedAttachments }) };
};
