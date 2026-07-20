// schedule-packet — the moment a customer is SCHEDULED, text them ONE thing:
// "you're set for {day, date}" (NO time — we run day-of routing), and — only if
// they haven't already done the intake — the warranty/cash intake link so they can
// shoot the 10-sec video + model pic that lets their tech bring the exact part.
//
// Fires from ant-schedule.js AntSchedule.schedule() after a successful save, so it
// covers ALL five office schedule surfaces with one hook and is FORWARD-ONLY by
// construction (only a NEW schedule action triggers it — never a backlog blast).
//
// Rules (Teddy 2026-07-20):
//   - DAY + DATE only, never a clock time.
//   - If the intake packet is already filled out (a video/photo is on file, or
//     they've given availability), send the confirmation ALONE — no second link.
//     If not, the confirmation carries the intake link with the "help your tech
//     figure it out faster" note.
//   - Dedup per (job, scheduled day): a board re-save never re-texts, but a real
//     RESCHEDULE to a new day re-confirms the new day.
//   - Opt-out + quiet-hours honored; SMS breaker + intake gate inherited from send_sms.
//
//   POST { job_id }                      -> send (the client hook)
//   GET  ?job_id=<id>[&dry=1][&force=1]  -> test / preview (dry = no send)
'use strict';

const { toE164 } = require('./_lib/sms');
const { isOptedOut } = require('./_lib/sms-guard');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
const ok = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });

function first(s) { return String(s || '').trim().split(/\s+/)[0] || 'there'; }
function maskPhone(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 4 ? '•••' + d.slice(-4) : d; }
function ctHour() { return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()), 10); }
const term = (s) => /cancel|delet|complete|no_fix/i.test(String(s || ''));
async function jget(url, ms = 9000) { try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return await r.json(); } catch (_) { return null; } }
async function jpost(url, body, ms = 9000) { try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); return await r.json(); } catch (_) { return null; } }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = (event && event.queryStringParameters) || {};
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(b.job_id || q.job_id, 10) || 0;
  const dry = q.dry === '1' || q.dry === 'true' || b.dry === true;
  const force = q.force === '1' || q.force === 'true';  // bypass quiet-hours + dedup for a test preview
  if (!jobId) return ok({ ok: false, error: 'job_id required' });

  // ── resolve the job once (office lens gives day/date, phone, availability, warranty) ──
  const tr = await jget(`${SITE}/.netlify/functions/job-truth?job_id=${jobId}&lens=office`, 12000);
  const f = tr && tr.facts;
  if (!f) return ok({ ok: false, error: 'job_not_found', job_id: jobId });

  // Only confirm a REAL, live schedule: needs a day + a tech, and not terminal.
  if (term(f.status)) return ok({ ok: false, skipped: 'terminal_status', status: f.status });
  if (!f.scheduled_day) return ok({ ok: false, skipped: 'no_scheduled_day' });
  if (!Number(f.technician_id)) return ok({ ok: false, skipped: 'no_tech_assigned' });

  const phoneDigits = String(f.customer_phone || '').replace(/\D/g, '');
  if (phoneDigits.length < 10) return ok({ ok: false, skipped: 'no_phone', job_id: jobId });
  const phone = toE164(phoneDigits);

  // ── dedup on (job, scheduled day): re-save never re-texts; a reschedule to a NEW day does ──
  const day = String(f.scheduled_day || '').trim();               // "Tuesday, Jul 22" (no time)
  const dayKey = day.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!force && !dry) {
    const dd = await jget(`${XANO}/list_recent_event_log?action=schedule_packet_sent_${jobId}&days_back=3650&limit=10`, 8000);
    const rows = (dd && dd.items) || [];
    const already = rows.some((r) => { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return String((m && m.day_key) || '') === dayKey; });
    if (already) return ok({ ok: true, skipped: 'already_sent_for_this_day', job_id: jobId, day });
  }

  // ── intake completeness: media on file (video/model pic) OR availability given ──
  let hasMedia = false, hasAvail = !!String(f.availability || '').trim();
  try {
    const st = await jget(`${XANO}/get_unified_tdr_status?job_id=${jobId}`, 8000);
    if (st && (st.has_photo || st.has_video || Number(st.attachments_count || 0) > 0)) hasMedia = true;
  } catch (_) {}
  const intakeDone = hasMedia || hasAvail;   // engaged with the packet → don't re-send the link

  // ── build the message ──
  const cust = first(f.customer_first);
  const appl = String(f.appliance || 'appliance').trim() || 'appliance';
  const isW = !!f.is_warranty;
  const link = isW ? `${SITE}/warranty-intake.html?job_id=${jobId}` : `${SITE}/appliance-ai.html?job_id=${jobId}&mode=resume`;

  let msg;
  if (intakeDone) {
    // They already sent the video/model or gave availability — just confirm the day.
    msg = `Hi ${cust}! 🐜 TN Appliance — you're all set for ${day}. We run our stops in the most efficient order, so we'll text you a live arrival window that morning. Questions? Just reply here. See you ${day}!`;
  } else {
    // Confirm the day AND invite the intake, with Teddy's "help your tech" note.
    msg = `Hi ${cust}! 🐜 TN Appliance — you're scheduled for ${day}. Want your tech to fix it in ONE trip? Take about a minute: a 10-second video of your ${appl}, a photo of the model-number sticker, and pick your times → ${link}. That's exactly how we bring the right part. See you ${day}!`;
  }

  if (dry) {
    return ok({ ok: true, dry_run: true, job_id: jobId, to: maskPhone(phone), day, type: isW ? 'warranty' : 'cash', intake_done: intakeDone, has_media: hasMedia, has_availability: hasAvail, would_include_link: !intakeDone, message: msg });
  }

  // Honor STOP.
  try { if (await isOptedOut(phone)) return ok({ ok: false, skipped: 'opted_out', job_id: jobId }); } catch (_) {}
  // Soft night guard — a schedule is a daytime office action, but never fire a text
  // in the dead of night if someone schedules at 1am. (Reactive/transactional daytime = fine.)
  const h = ctHour();
  if (!force && (h < 7 || h >= 21)) return ok({ ok: false, skipped: 'quiet_hours', ct_hour: h, job_id: jobId });

  // Send through the guarded chokepoint. Tag contains "intake" so the intake-only
  // gate passes it (it IS the scheduling+intake packet).
  const sendRes = await jpost(`${XANO}/send_sms`, { to: phone, message: msg, context_tag: 'intake_schedule_packet' }, 10000);
  const sent = !!(sendRes && sendRes.success);
  if (sent) {
    // Per-day dedup marker (so a re-save can't re-text, a reschedule can).
    try { await jpost(`${XANO}/record_event_log`, { action: `schedule_packet_sent_${jobId}`, metadata_json: JSON.stringify({ job_id: jobId, day, day_key: dayKey, had_link: !intakeDone, phone: maskPhone(phone), at_ms: Date.now() }) }); } catch (_) {}
    // Audit row (unindexed action) for the daily pulse.
    try { await jpost(`${XANO}/record_event_log`, { action: 'schedule_packet_sent', metadata_json: JSON.stringify({ job_id: jobId, day, had_link: !intakeDone, at_ms: Date.now() }) }); } catch (_) {}
  }
  return ok({ ok: sent, job_id: jobId, day, sent, had_link: !intakeDone, to: maskPhone(phone), reason: sent ? undefined : (sendRes && (sendRes.error || sendRes.provider)) || 'send_failed' });
};
