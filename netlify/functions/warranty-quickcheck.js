// warranty-quickcheck — the WARRANTY version of the Quick Check intake. Warranty
// customers pay nothing; the value is the pre-diagnosis (video + model photo) so
// the tech rolls up ready. Mirrors free-quickcheck but labels the job WARRANTY
// (not self_pay — that was the mislabel bug) and carries warranty company/claim.
// Links + OCRs any media, fires the siren to Teddy + Danielle, and texts a
// finish-upload link if media didn't land. Idempotent per conversation_id.
//
// NOTE on dedup: the dup-PROOF path is the texted link carrying job_id (prefill),
// which attaches to the EXISTING dispatch job. Until that's wired, this matches a
// returning warranty customer by phone (create_job_from_chat inherits warranty)
// and otherwise creates a WARRANTY-labeled job (mergeable, never a self_pay dup).
//
//   POST { name, phone, appliance, brand, problem, warranty_company, claim_number,
//          conv_id, sms_consent, has_video, has_model, town, language }
//   -> { ok, job_id, first_name }
'use strict';
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const OWNER = '+16154855795';     // Teddy
const DANIELLE = '+16154850713';

function rowMeta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
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
    const prior = await crud.searchPage(crud.TABLES.event_log, { action: 'warranty_quick_check_created' }, { created_at: 'desc' }, 200);
    const hit = (prior || []).find((r) => convId && rowMeta(r).conv_id === String(convId));
    if (hit) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, already: true, job_id: rowMeta(hit).job_id, first_name: first }) };
  } catch (_) {}

  // create/match the WARRANTY job (returning warranty customers are matched by phone
  // and inherit warranty; new ones land warranty-labeled in Needs Scheduled).
  const nameParts = String(m.name || '').trim().split(/\s+/);
  let jobId = null, linkedAttachments = 0, photoLinked = false, videoLinked = false;
  try {
    const r = await fetch(`${XANO}/create_job_from_chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: nameParts[0] || 'Customer',
        last_name: nameParts.slice(1).join(' '),
        phone: phone,
        appliance_type: m.appliance || 'appliance',
        brand: m.brand || '',
        problem_summary: '🛡️ WARRANTY QUICK CHECK — ' + (m.problem || ''),
        customer_type: 'warranty',
        warranty_company: m.warranty_company || '',
        claim_number: m.claim_number || '',
        recommended_service: 'warranty_prediag',
        channel: 'appliance_ai',
        // create_job_from_chat REQUIRES a non-empty zip or it fails ("Missing param: zip")
        // → job_id null → office fallback + media never links (the warranty-intake bug,
        // 2026-06-26). The minimal warranty flow only asks phone, so default to the shop
        // zip; the REAL service address comes from the warranty dispatch match / scheduling.
        zip: (m.zip && String(m.zip).trim()) || '37013',
        sms_consent: m.sms_consent === true || m.sms_consent === 'yes',
        conversation_id: convId,
      }),
    });
    const d = await r.json().catch(() => ({}));
    jobId = (d && (d.id || d.job_id)) || null;
  } catch (_) {}

  // make sure warranty company/claim stick even if create_job_from_chat ignores them
  if (jobId && (m.warranty_company || m.claim_number)) {
    try {
      const patch = {};
      if (m.warranty_company) patch.warranty_company = m.warranty_company;
      if (m.claim_number) patch.claim_number = m.claim_number;
      await crud.update(crud.TABLES.jobs, jobId, patch);
    } catch (_) {}
  }

  // link + OCR any media that landed (best-effort) — same as the cash path
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
  const availability = String(m.availability || '').trim();
  // Availability + language both land in customer_preference_text (the routing/
  // scheduling layer reads it). Availability first — it's what gets them scheduled.
  const floorsLabel = String(m.floors_label || '').trim();
  if (jobId && (availability || floorsLabel || LANGNAME[lang])) {
    const parts = [];
    if (availability) parts.push('🗓 Availability: ' + availability);
    if (floorsLabel) parts.push('🛟 FLOORS: ' + floorsLabel);
    if (LANGNAME[lang]) parts.push('⚑ Customer language: ' + LANGNAME[lang] + ' — reply in their language (Ant auto-translates).');
    try { await crud.update(crud.TABLES.jobs, jobId, { customer_preference_text: parts.join('  ·  ') }); } catch (_) {}
  }

  await crud.logEvent('warranty_quick_check_created', { conv_id: convId ? String(convId) : '', job_id: jobId, name: m.name, phone: phone, warranty_company: m.warranty_company || '', claim_number: m.claim_number || '', machine: [m.brand, m.appliance].filter(Boolean).join(' '), town: m.town, problem: m.problem, availability: availability, language: lang, linked_attachments: linkedAttachments, at_ms: Date.now() });

  // 🛡️ siren → Teddy + Danielle (pre-diagnosis ready — get the tech rolling ready)
  const link = jobId ? (`${SITE}/teddy-tdr-tool.html?job_id=${jobId}`) : `${SITE}/office-board.html`;
  const machine = [m.brand, m.appliance].filter(Boolean).join(' ') || 'appliance';
  const mediaNote = linkedAttachments > 0 ? '' : '  ⏳ no video/pic yet — customer was sent the shoot-it link';
  const msg = '🛡️ WARRANTY pre-diagnosis — ' + (m.name || '(customer)') + ' · ' + machine
    + (m.town ? (' · ' + m.town) : '') + ' — ' + String(m.problem || '').slice(0, 110)
    + (m.warranty_company ? (' · ' + m.warranty_company) : '')
    + '  Job #' + (jobId || '?') + ' → ' + link + mediaNote;
  try { await sendSms(OWNER, msg, 'owner', 'warranty_quick_check'); } catch (_) {}
  try { await sendSms(DANIELLE, msg, 'warranty_handler', 'warranty_quick_check'); } catch (_) {}

  // If the SUBMITTER is one of our techs (testing the flow), text THEM the Teddy
  // Tool link too — so they see exactly what the office/Teddy Tool sees. (Teddy
  // 2026-06-26 — Jimmy testing the warranty intake.)
  const TECH_PHONES10 = ['6154855795', '6159671304', '5049099413', '6158291654', '7315049617', '8133527686'];
  const submitterLast10 = phone.replace(/\D/g, '').slice(-10);
  if (jobId && TECH_PHONES10.includes(submitterLast10)) {
    const techMsg = '🔧 That\'s your test submission — here\'s exactly what Teddy + the office see in the Teddy Tool: ' + link;
    try { await sendSms(phone, techMsg, 'technician', 'warranty_qc_tech_preview'); } catch (_) {}
  }

  // never lose the media — text a finish-upload link if expected media didn't land
  const yes = (v) => v === true || String(v) === 'yes' || String(v) === 'true';
  const videoMissing = yes(m.has_video) && !videoLinked;
  const photoMissing = yes(m.has_model) && !photoLinked;
  let customerTexted = false;
  if (jobId && (videoMissing || photoMissing)) {
    try { await crud.update(crud.TABLES.jobs, jobId, { media_status: 'pending' }); } catch (_) {}
    await crud.logEvent('quick_check_media_pending', { job_id: jobId, conv_id: convId ? String(convId) : '', phone: phone, video_missing: videoMissing, photo_missing: photoMissing, at_ms: Date.now() });
    if (yes(m.sms_consent) && phone) {
      const finishLink = `${SITE}/warranty-intake.html?job_id=${jobId}`;
      const what = (videoMissing && photoMissing) ? 'your video + model photo' : (videoMissing ? 'your video' : 'the model-number photo');
      const cmsg = 'TN Appliance: got it! When you have a sec on better signal, tap to add ' + what + ' so your tech shows up ready: ' + finishLink + '  (Reply STOP to opt out.)';
      try { await sendSms(phone, cmsg, 'customer', 'quick_check_media'); customerTexted = true; } catch (_) {}
    }
  }

  // Close the intake->schedule loop: media landed clean, so confirm receipt +
  // next step + ask availability so nobody's left hanging after sending a video
  // (Teddy 7/3). Suppressed if we already texted a finish-upload link above.
  if (jobId) { try { await require('./_lib/intake-ack').sendIntakeAck({ job_id: jobId, phone, name: m.name, appliance: m.appliance, availability, consent: m.sms_consent, suppressed: customerTexted }); } catch (_) {} }

  // Record the line/hose safety-offer decision (Teddy 2026-06-27) — across the
  // board, WARRANTY INCLUDED. A recorded DECLINE is the liability protection;
  // a YES tells the office to bring + install it.
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
