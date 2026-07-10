// free-quickcheck — FREE version of the Quick Check (no Stripe). Called directly
// by the appliance-AI flow's submit so a bad-signal customer can finish without
// a payment step (the thing that kept dropping). Creates the cash job, links any
// media that landed, OCR-reads the model sticker, fires the 💵 siren, and texts a
// finish-upload link if media didn't make it. Idempotent per conversation_id.
//
//   POST { name, phone, email, address, city, zip, appliance, brand, problem,
//          conv_id, sms_consent, has_video, has_model, town }
//   -> { ok, job_id, first_name }

'use strict';
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
  let m = {}; try { m = JSON.parse(event.body || '{}'); } catch (_) {}

  const phone = String(m.phone || '').trim();
  if (phone.replace(/\D/g, '').length < 10) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'valid phone required' }) };
  const first = String(m.name || '').trim().split(/\s+/)[0] || '';
  const convId = parseInt(String(m.conv_id || '').replace(/\D/g, ''), 10) || null;

  // idempotency — a retry/double-tap with the same conversation must not double-create
  try {
    const prior = await crud.searchPage(crud.TABLES.event_log, { action: 'free_quick_check_created' }, { created_at: 'desc' }, 200);
    const hit = (prior || []).find((r) => convId && rowMeta(r).conv_id === String(convId));
    if (hit) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, already: true, job_id: rowMeta(hit).job_id, first_name: first }) };
  } catch (_) {}

  // create the cash job (lands in Needs Scheduled, flagged self_pay)
  const nameParts = String(m.name || '').trim().split(/\s+/);
  let jobId = null, linkedAttachments = 0, photoLinked = false, videoLinked = false;
  try {
    const r = await fetch(`${XANO}/create_job_from_chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: nameParts[0] || 'Customer',
        last_name: nameParts.slice(1).join(' '),
        phone: phone,
        zip: m.zip || '',
        appliance_type: m.appliance || 'appliance',
        brand: m.brand || '',
        problem_summary: '💵 FREE QUICK CHECK — ' + (m.problem || ''),
        customer_type: 'self_pay',
        recommended_service: 'quick_check',
        channel: 'appliance_ai',
        sms_consent: m.sms_consent === true || m.sms_consent === 'yes',
        conversation_id: convId,
      }),
    });
    const d = await r.json().catch(() => ({}));
    jobId = (d && (d.id || d.job_id)) || null;
  } catch (_) {}

  // link + OCR any media that landed (best-effort)
  if (jobId) {
    try {
      const ar = await fetch(`${XANO}/get_job_attachments?job_id=${jobId}`);
      const ad = await ar.json().catch(() => ({}));
      const atts = (ad && Array.isArray(ad.attachments)) ? ad.attachments : [];
      linkedAttachments = (ad && ad.count != null) ? ad.count : atts.length;
      videoLinked = atts.some((a) => a && (a.file_type === 'video' || (a.s3_key && String(a.s3_key).startsWith('cfstream:'))));
      photoLinked = atts.some((a) => a && a.file_type === 'photo' && !(a.s3_key && String(a.s3_key).startsWith('cfstream:')));
      const photo = atts.find((a) => a && (a.file_type === 'photo' || (a.s3_key && !String(a.s3_key).startsWith('cfstream:') && /\.(jpe?g|png|heic|webp)$/i.test(a.s3_key))));
      if (photo && photo.s3_key) {
        const vr = await fetch(`${SITE}/.netlify/functions/s3-view-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s3_keys: [photo.s3_key] }) });
        const vd = await vr.json().catch(() => ({}));
        const viewUrl = (vd && vd.signed_urls && vd.signed_urls[0] && vd.signed_urls[0].view_url) || (vd && vd.view_url) || '';
        if (viewUrl) fetch(`${SITE}/.netlify/functions/ocr-model-extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, image_url: viewUrl, attachment_id: photo.id || null }) }).catch(() => {});
      }
    } catch (_) {}
  }

  const lang = String(m.language || 'en').toLowerCase();
  const LANGNAME = { es: 'Spanish', vi: 'Vietnamese', ar: 'Arabic', hi: 'Hindi', fr: 'French' };
  if (jobId && (m.address || m.city || m.availability || m.floors_label || LANGNAME[lang])) {
    const pref = [m.availability || '', m.floors_label ? ('🛟 FLOORS: ' + m.floors_label) : '', LANGNAME[lang] ? ('⚑ Customer language: ' + LANGNAME[lang] + ' — reply in their language (Ant auto-translates).') : ''].filter(Boolean).join(' · ');
    try { await crud.update(crud.TABLES.jobs, jobId, { service_address: m.address || '', service_city: m.city || '', service_state: stateFromZip(m.zip), customer_preference_text: pref }); } catch (_) {}
  }

  await crud.logEvent('free_quick_check_created', { conv_id: convId ? String(convId) : '', job_id: jobId, name: m.name, phone: phone, email: m.email || '', machine: [m.brand, m.appliance].filter(Boolean).join(' '), town: m.town, problem: m.problem, sms_consent: m.sms_consent, language: lang, linked_attachments: linkedAttachments, at_ms: Date.now() });

  // 💵 siren → Teddy + Danielle (FREE, so they jump on it)
  const link = jobId ? (`${SITE}/teddy-tdr-tool.html?job_id=${jobId}`) : `${SITE}/office-board.html`;
  const machine = [m.brand, m.appliance].filter(Boolean).join(' ') || 'appliance';
  // Flag when there's no media yet so Teddy/Danielle don't tap into an empty tool
  // (Teddy 2026-06-26). The shoot-it link was texted to the customer; the media-
  // arrival ping will fire the real "ready to diagnose" notification.
  const mediaNote = linkedAttachments > 0 ? '' : '  ⏳ no video/pic yet — customer was sent the shoot-it link';
  // Fresh strategy (Teddy 7/9): the Teddy Tool also goes to the zip's tech.
  const areaTech = await resolveAreaTech(m.zip || '');
  const areaNote = bossSirenNote(jobId, areaTech);
  const msg = '💵 FREE QUICK-CHECK — ' + (m.name || '(caller)') + ' · ' + machine
    + (m.town ? (' · ' + m.town) : '') + ' — ' + String(m.problem || '').slice(0, 120)
    + '  Job #' + (jobId || '?') + ' → ' + link + mediaNote + areaNote;
  try { await sendSms(OWNER, msg, 'owner', 'quick_check'); } catch (_) {}
  try { await sendSms(DANIELLE, msg, 'warranty_handler', 'quick_check'); } catch (_) {}
  if (jobId) { try { await sendAreaTechTeddyTool(areaTech, { link, customer: m.name, appliance: machine, city: m.town || m.city || '', jobId, kind: 'free_qc' }); } catch (_) {} }

  // never lose the media — text the no-form finish-upload link if expected media
  // didn't land, AND ALWAYS for the in-home $100 path (Teddy 2026-06-26: every
  // in-home customer MUST shoot a video + send the model photo so we never roll a
  // truck unprepared / go out twice). They pay only at the visit.
  const yes = (v) => v === true || String(v) === 'yes' || String(v) === 'true';
  const isInHome = String(m.service_type || '') === 'in_home_diagnostic';
  const videoMissing = yes(m.has_video) && !videoLinked;
  const photoMissing = yes(m.has_model) && !photoLinked;
  let customerTexted = false;
  if (jobId && (isInHome || videoMissing || photoMissing)) {
    try { await crud.update(crud.TABLES.jobs, jobId, { media_status: 'pending' }); } catch (_) {}
    await crud.logEvent('quick_check_media_pending', { job_id: jobId, conv_id: convId ? String(convId) : '', phone: phone, in_home: isInHome, video_missing: videoMissing, photo_missing: photoMissing, at_ms: Date.now() });
    if (yes(m.sms_consent) && phone) {
      const finishLink = `${SITE}/finish-upload.html?job_id=${jobId}`;
      if (isInHome && !videoLinked && !photoLinked) {
        const cmsg = 'TN Appliance: you\'re on the schedule! One quick must-do so your tech rolls up ready to fix it the first trip — tap here to shoot a short video of the problem + a photo of the model-number sticker: ' + finishLink + '  (Reply STOP to opt out.)';
        try { await sendSms(phone, cmsg, 'customer', 'in_home_media'); customerTexted = true; } catch (_) {}
      } else {
        const what = (videoMissing && photoMissing) ? 'your video + model photo' : (videoMissing ? 'your video' : 'the model-number photo');
        const cmsg = 'TN Appliance: got your Quick Check! When you have a sec on better signal, tap to add ' + what + ' so we can nail the diagnosis: ' + finishLink + '  (Reply STOP to opt out.)';
        try { await sendSms(phone, cmsg, 'customer', 'quick_check_media'); customerTexted = true; } catch (_) {}
      }
    }
  }

  // Close the intake->schedule loop: media landed clean, so confirm receipt +
  // next step + ask availability so nobody's left hanging after sending a video
  // (Teddy 7/3). Suppressed if we already texted a finish-upload / schedule note.
  if (jobId) { try { await require('./_lib/intake-ack').sendIntakeAck({ job_id: jobId, phone, name: m.name, appliance: m.appliance, availability: m.availability, consent: m.sms_consent, suppressed: customerTexted }); } catch (_) {} }

  // Record the line/hose safety-offer decision (Teddy 2026-06-27) — a recorded
  // DECLINE is the liability protection; a YES tells the office to bring it.
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
  const floorsChoice = String(m.floors || '').toLowerCase();
  if (jobId && floorsChoice && floorsChoice !== 'standard') {
    try { await crud.logEvent('floors_flag', { job_id: jobId, choice: floorsChoice, label: String(m.floors_label || ''), at_ms: Date.now() }); } catch (_) {}
    if (floorsChoice === 'air_sled') {
      const fmsg = '🛟 AIR-SLED ($125) requested on job #' + jobId + ' (' + (m.name || 'customer') + ') — route a sled-equipped tech + add $125 to the ticket.';
      try { await sendSms(DANIELLE, fmsg, 'warranty_handler', 'air_sled_request'); } catch (_) {}
    }
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, job_id: jobId, first_name: first, media_linked: linkedAttachments }) };
};
