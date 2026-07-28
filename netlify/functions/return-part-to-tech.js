// return-part-to-tech — the distributed returns flow. When a tech marks a supplied
// part UNUSED in the field, this finds that part's prepaid RMA label (matched by
// part number, via return-label-find) and sends it straight to THAT tech's phone,
// so he prints it, boxes the part, and puts it out for his own daily FedEx pickup.
// Kills the central 150-pile at the source.
//   POST { job_id, part, tech_id, claim? }
//   -> { ok, label_image_url, print_url, distributor, rma, texted }
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }
const SITE = 'https://tnapplianceexchange.net';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

// System-of-record cells (Andre = the 504, per the roster footgun).
const TECH_PHONES = { 1: '+16154855795', 2: '+16159671304', 3: '+15049099413', 4: '+16158291654', 6: '+18133527686' };
const normPart = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = Number(b.job_id || 0);
  const part = String(b.part || '').trim();
  const techId = Number(b.tech_id || 0);
  if (!part || (!jobId && !b.claim)) return json(400, { ok: false, error: 'part + job_id (or claim) required' });

  // 1) resolve the claim# for this job (needed to find the RMA email)
  let claim = String(b.claim || '').replace(/[^0-9]/g, '');
  if (!claim && jobId) {
    try {
      const r = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(8000) });
      if (r.ok) { const d = await r.json(); claim = String((d.job && (d.job.claim_number || d.job.dispatch_source_id)) || '').replace(/[^0-9]/g, ''); }
    } catch (_) {}
  }
  if (!claim) return json(200, { ok: false, error: 'no claim number on this job — return through the office' });

  // 2) find the label for THIS part (reuse the finder's part-matching, server-side)
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let labels = [];
  try {
    const r = await fetch(`${SITE}/.netlify/functions/return-label-find`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: admin, query: `${claim} ${part}` }), signal: AbortSignal.timeout(24000) });
    const d = await r.json(); labels = (d && d.labels) || [];
  } catch (_) {}
  const want = normPart(part);
  const match = labels.find((l) => l.part_match) || labels.find((l) => normPart(l.part_number) === want) || labels.find((l) => l.has_image) || labels[0];
  if (!match) return json(200, { ok: false, error: 'no return label found for this part yet — it may not have been issued', claim });

  const label_image_url = match.label_image_url || '';
  const print_url = label_image_url ? `${SITE}/label-print.html?u=${encodeURIComponent(label_image_url)}` : (match.label_url || '');
  const distributor = match.distributor || '';
  const rma = match.rma || '';
  const gmail_link = match.gmail_link || '';

  // 3) text the label straight to the tech's phone. Skip the text when the caller
  //    asks (notify:false) — e.g. the My Returns worklist, where the tech is already
  //    looking at the label on screen and a text would just be noise.
  let texted = false;
  const wantText = b.notify !== false && b.notify !== 'false';
  const phone = TECH_PHONES[techId] || '';
  if (wantText && phone && print_url) {
    const msg = `↩️ RETURN: part ${part}${distributor ? ' → ' + distributor : ''}. Print the label, box the part, put it out for FedEx pickup: ${print_url}  Tap "✓ Put out for pickup" in your app when it's out.`;
    try { await sendSms(phone, msg, 'technician', 'part_return_label'); texted = true; } catch (_) {}
  }

  return json(200, { ok: true, part, claim, distributor, rma, label_image_url, print_url, gmail_link, has_image: !!label_image_url, texted });
};
