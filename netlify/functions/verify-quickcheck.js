// verify-quickcheck — called by the thank-you page after Stripe redirect.
// Verifies the $50 actually cleared, then (idempotently) creates the cash job,
// records the payment, and fires the 💵 CASH siren to Teddy + Danielle.
//
//   POST { session_id }  ->  { ok, paid, job_id, first_name }

'use strict';
const Stripe = require('stripe');
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
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
        problem_summary: '💵 QUICK CHECK ($50 PAID) — ' + (m.problem || ''),
        customer_type: 'self_pay',
        recommended_service: 'quick_check',
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
  if (jobId && (m.address || m.city)) {
    try {
      await crud.update(crud.TABLES.jobs, jobId, {
        service_address: m.address || '',
        service_city: m.city || '',
        service_state: stateFromZip(m.zip),
      });
    } catch (_) {}
  }

  // record the payment + the idempotency marker
  const amount = Number(m.amount_cents || 5000) / 100;
  await crud.logEvent('quick_check_paid', { session_id: sessionId, job_id: jobId, conv_id: m.conv_id || '', linked_attachments: linkedAttachments, amount, name: m.name, phone: m.phone, email: m.email || '', machine: m.machine, town: m.town, sms_consent: m.sms_consent, at_ms: Date.now() });
  await crud.logEvent('customer_payment_received', { job_id: jobId, amount, kind: 'quick_check', session_id: sessionId, source: 'quick_check', at_ms: Date.now() });

  // 💵 CASH siren → Teddy + Danielle
  const link = jobId ? (`${SITE}/teddy-tdr-tool.html?job_id=${jobId}`) : `${SITE}/office-board.html`;
  const msg = '💵💵 CASH QUICK-CHECK PAID — $' + amount + ' · ' + (m.name || '(caller)') + ' · ' + (m.machine || 'appliance')
    + (m.town ? (' · ' + m.town) : '') + ' — ' + (m.problem || '').slice(0, 120)
    + '  Job #' + (jobId || '?') + ' → GET ON IT: ' + link;
  try { await sendSms(OWNER, msg, 'owner', 'quick_check'); } catch (_) {}
  try { await sendSms(DANIELLE, msg, 'warranty_handler', 'quick_check'); } catch (_) {}

  // ── Never lose the media ──────────────────────────────────────────────────
  // If the video/photo didn't land (low signal that never recovered before the
  // Stripe redirect), flag the job and text the customer a one-tap link to finish
  // the upload from wherever they have signal — it links back by the same job.
  const yes = (v) => String(v) === 'yes' || String(v) === 'true';
  const expectedVideo = yes(m.has_video), expectedPhoto = yes(m.has_model);
  const videoMissing = expectedVideo && !videoLinked;
  const photoMissing = expectedPhoto && !photoLinked;
  if (jobId && (videoMissing || photoMissing)) {
    try { await crud.update(crud.TABLES.jobs, jobId, { media_status: 'pending' }); } catch (_) {}
    await crud.logEvent('quick_check_media_pending', { job_id: jobId, conv_id: m.conv_id || '', phone: m.phone, video_missing: videoMissing, photo_missing: photoMissing, at_ms: Date.now() });
    if (yes(m.sms_consent) && m.phone) {
      const finishLink = `${SITE}/finish-upload.html?job_id=${jobId}`;
      const what = (videoMissing && photoMissing) ? 'your video + model photo' : (videoMissing ? 'your video' : 'the model-number photo');
      const cmsg = 'TN Appliance: got your $' + amount + ' Quick Check! It looks like ' + what + ' didn\'t fully upload on the last signal. Tap to finish so we can diagnose it fast: ' + finishLink + '  (Reply STOP to opt out.)';
      try { await sendSms(m.phone, cmsg, 'customer', 'quick_check_media'); } catch (_) {}
    }
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, paid: true, job_id: jobId, first_name: first, media_linked: linkedAttachments }) };
};
