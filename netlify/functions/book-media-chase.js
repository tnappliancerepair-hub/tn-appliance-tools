// book-media-chase — if a "Book a Repair" lead goes quiet, gently text them ONCE
// to recover whatever's still missing to turn them into a scheduled cash job:
//   (a) AVAILABILITY — the day/time they want a tech (this is what actually lets
//       the office schedule; the #1 thing to recover), and/or
//   (b) MEDIA — model-# pic + problem video (so the Teddy Tool isn't blank).
// The message adapts to what's missing. HARD one-chase-per-job dedup — the old
// intake-collector spammed a customer 5x and got disabled; never again.
//
// Runs hourly; self-gates to 9a-7p CT, waits 2h after booking, skips jobs that
// already gave BOTH availability + media, or were already chased. Kill switch:
// vault BOOK_MEDIA_CHASE=false.
//   GET ?dryrun=1   inspect without sending
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const EVENT_LOG = 3;
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function ctHour() { try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date())); } catch (_) { return 12; } }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') return '+' + d; if (d.length === 10) return '+1' + d; return d ? ('+' + d) : ''; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  if (String(await getSecret('BOOK_MEDIA_CHASE') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  const hour = ctHour();
  if (!dry && (hour < 9 || hour >= 19)) return json(200, { ok: true, skipped: 'outside 9a-7p CT' });

  const now = Date.now(), WINDOW = 48 * 3600 * 1000, WAIT = 2 * 3600 * 1000;
  let leads = [], chased = [];
  try { leads = await crud.searchPage(EVENT_LOG, { action: 'web_book_lead' }, { created_at: 'desc' }, 200); } catch (_) {}
  try { chased = await crud.searchPage(EVENT_LOG, { action: 'book_media_chase_sent' }, { created_at: 'desc' }, 300); } catch (_) {}
  const chasedJobs = new Set(chased.map((r) => Number(meta(r).job_id)).filter(Boolean));

  const sent = [], skipped = [];
  for (const r of leads) {
    const m = meta(r);
    const jobId = Number(m.job_id || 0); if (!jobId) continue;
    const at = Number(m.at_ms) || (r.created_at ? Date.parse(r.created_at) : 0);
    if (now - at > WINDOW) continue;                                  // too old, give up
    if (now - at < WAIT) { skipped.push({ job: jobId, why: 'too fresh (<2h)' }); continue; }
    if (chasedJobs.has(jobId)) { skipped.push({ job: jobId, why: 'already chased' }); continue; }
    // What's still missing? Media (attachments) and/or availability (their reply
    // was parsed onto the job -> availability_captured_<job> marker). Recover
    // whatever's outstanding; if they've given BOTH, leave them alone.
    let hasMedia = false;
    try { const a = await fetch(`${XANO}/get_job_attachments?job_id=${jobId}`, { signal: AbortSignal.timeout(10000) }).then((x) => x.json()); hasMedia = ((a && a.attachments) || []).some((x) => x.upload_complete_at); } catch (_) {}
    let hasAvail = false;
    try { const av = await crud.searchPage(EVENT_LOG, { action: 'availability_captured_' + jobId }, { id: 'desc' }, 1); hasAvail = !!(av && av.length); } catch (_) {}
    if (hasMedia && hasAvail) { skipped.push({ job: jobId, why: 'has availability + media' }); continue; }
    const phone = e164(m.phone); if (!phone) { skipped.push({ job: jobId, why: 'no phone' }); continue; }
    const first = m.first_name || 'there';
    const apl = m.appliance ? (' ' + String(m.appliance).toLowerCase()) : ' appliance';
    const link = `https://tnapplianceexchange.net/finish-upload.html?job_id=${jobId}`;
    // Tailor the ask to what's outstanding. Availability is the priority recover.
    let msg;
    if (!hasAvail && !hasMedia) {
      msg = `Hi ${first}, still here to help with your${apl}! Two quick things to get you scheduled: 1) what days/times work to get a tech out? (just reply here) 2) a photo of the model-# sticker + short video of the problem helps us show up ready: ${link} — TN Appliance Exchange 🐜`;
    } else if (!hasAvail) {
      msg = `Hi ${first}, got your photos — thank you! Just need to know what days/times work to get a tech out to your${apl}, and we'll get you on the schedule. Reply right here. — TN Appliance Exchange 🐜`;
    } else {
      msg = `Hi ${first}, thanks — we've got your availability! Whenever you get a sec, a quick photo of the model-# sticker + a short video of the problem lets us show up with the right part: ${link} — TN Appliance Exchange 🐜`;
    }

    const want = (!hasAvail && !hasMedia) ? 'availability+media' : (!hasAvail ? 'availability' : 'media');
    if (dry) { sent.push({ job: jobId, want, preview: msg.slice(0, 90) }); continue; }
    // claim BEFORE sending (so a double-run can't double-text), then send
    try { await crud.logEvent('book_media_chase_sent', { job_id: jobId, phone: m.phone || '', want, at_ms: Date.now() }); } catch (_) {}
    chasedJobs.add(jobId);
    try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: phone, message: msg, customer_first_name: first, context_tag: 'book_media_chase' }), signal: AbortSignal.timeout(12000) }); } catch (_) {}
    sent.push({ job: jobId });
  }
  return json(200, { ok: true, mode: dry ? 'dryrun' : 'live', ct_hour: hour, leads: leads.length, sent: sent.length, skipped: skipped.length, sent_list: sent.slice(0, 10), skipped_list: skipped.slice(0, 8) });
};
