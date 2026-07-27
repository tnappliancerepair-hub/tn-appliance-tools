// video-resend-sweep — the self-heal for failure videos that never made it to Cloudflare.
// Intake marks a video "done" the instant the upload URL is minted, so any customer who
// loses signal mid-send leaves a dead clip that shows as a black box in the tools. This
// sweep finds EVERY broken state and texts the customer their intake link to re-send —
// before Teddy or Danielle ever open the job.
//
// Covers ALL the ways a video fails to arrive:
//   pendingupload  — Cloudflare made the slot, bytes never finished (lost signal)   → re-send
//   error          — encode failed (corrupt / bad container)                        → re-send
//   not_found      — uid deleted / never existed                                    → re-send
//   inprogress/queued STUCK past a grace window (still not ready after ~25 min)      → re-send
// Never nags a job that already has ONE ready/usable video (multi-video stops), never a
// terminal job, respects opt-out + quiet hours + the shared 2-text intake cap, and won't
// re-send the same job more than twice or within 24h.
//
// Runs hourly, self-gates 9a-8p CT. Kill switch: vault VIDEO_RESEND_SWEEP=false.
//   GET ?dryrun=1   inspect without sending    ·    ?secret=<admin> for a manual run
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const EVENT_LOG = 3;
const WINDOW_MS = 48 * 3600 * 1000;   // only chase videos minted in the last 48h
const GRACE_MS = 25 * 60 * 1000;      // ignore anything <25 min old (upload may still be in flight / encoding)
const RESEND_COOLDOWN_MS = 24 * 3600 * 1000;
const MAX_RESENDS = 2;

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function ctHour() { try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date())); } catch (_) { return 12; } }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') return '+' + d; if (d.length === 10) return '+1' + d; return d ? ('+' + d) : ''; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
const STUCK = new Set(['pendingupload', 'error', 'not_found', 'downloading']);

// Ask Cloudflare the real state of a batch of uids (chunks of 20).
async function streamStates(uids) {
  const out = {};
  for (let i = 0; i < uids.length; i += 20) {
    const chunk = uids.slice(i, i + 20);
    try {
      const r = await fetch(`${SITE}/.netlify/functions/stream-status?uids=${encodeURIComponent(chunk.join(','))}`, { signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      if (d && d.ok && d.videos) Object.assign(out, d.videos);
    } catch (_) {}
  }
  return out;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const dry = q.dryrun === '1' || q.dry === '1';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  // Scheduled invocations carry {next_run} and no ?secret= — self-authorize those.
  let scheduled = false; try { scheduled = !!body.next_run; } catch (_) {}
  if (!scheduled && !dry && q.secret !== admin) return json(401, { error: 'unauthorized' });

  if (String(await getSecret('VIDEO_RESEND_SWEEP') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  const hour = ctHour();
  if (!dry && q.force !== '1' && (hour < 9 || hour >= 20)) return json(200, { ok: true, skipped: 'outside 9a-8p CT', ct_hour: hour });

  const now = Date.now();

  // 1) Every video we minted recently — the exact list to verify.
  let minted = [];
  try { minted = await crud.searchPage(EVENT_LOG, { action: 'stream_upload_minted' }, { created_at: 'desc' }, 250); } catch (_) {}
  // Group uids by job, keeping the newest mint time per job.
  const byJob = new Map();
  for (const r of minted) {
    const m = meta(r);
    const uid = String(m.uid || '').replace(/[^0-9a-zA-Z]/g, '');
    const jobId = Number(m.job_id || 0);
    const at = Number(m.at_ms) || (r.created_at ? Date.parse(r.created_at) : 0);
    if (!uid || !jobId || !at) continue;
    if (now - at > WINDOW_MS) continue;
    if (!byJob.has(jobId)) byJob.set(jobId, { uids: [], newest: 0, oldestBeyondGrace: 0 });
    const g = byJob.get(jobId);
    if (g.uids.indexOf(uid) === -1) g.uids.push(uid);
    g.newest = Math.max(g.newest, at);
    if (now - at >= GRACE_MS) g.oldestBeyondGrace = Math.max(g.oldestBeyondGrace, at);
  }
  if (!byJob.size) return json(200, { ok: true, mode: dry ? 'dryrun' : 'live', ct_hour: hour, minted: minted.length, candidates: 0 });

  // 2) Verify every uid's real Cloudflare state in one batch.
  const allUids = [...new Set([].concat(...[...byJob.values()].map((g) => g.uids)))];
  const states = await streamStates(allUids);

  // 3) Prior re-sends (dedup + cooldown + cap).
  let priorSends = [];
  try { priorSends = await crud.searchPage(EVENT_LOG, { action: 'video_resend_sent' }, { created_at: 'desc' }, 400); } catch (_) {}
  const sendsByJob = new Map();
  for (const r of priorSends) {
    const m = meta(r); const jid = Number(m.job_id || 0); if (!jid) continue;
    const at = Number(m.at_ms) || (r.created_at ? Date.parse(r.created_at) : 0);
    if (!sendsByJob.has(jid)) sendsByJob.set(jid, []);
    sendsByJob.get(jid).push(at);
  }

  const sent = [], skipped = [];
  for (const [jobId, g] of byJob) {
    // A job with ANY ready/usable video is fine — never nag it (multi-video stops).
    const readyCount = g.uids.filter((u) => states[u] && states[u].ready).length;
    if (readyCount > 0) { skipped.push({ job: jobId, why: 'has a ready video' }); continue; }
    // Which of its videos are genuinely broken (past the grace window)?
    const brokenNow = g.uids.filter((u) => {
      const v = states[u]; if (!v) return false;
      if (STUCK.has(v.state)) return true;
      // stuck in processing long past when it should have finished
      if (!v.ready && (v.state === 'inprogress' || v.state === 'queued')) return true;
      return false;
    });
    if (!brokenNow.length) { skipped.push({ job: jobId, why: 'nothing broken yet' }); continue; }
    if (!g.oldestBeyondGrace) { skipped.push({ job: jobId, why: 'too fresh (<25m) — upload may still be arriving' }); continue; }

    // Dedup / cooldown / cap.
    const prior = sendsByJob.get(jobId) || [];
    if (prior.length >= MAX_RESENDS) { skipped.push({ job: jobId, why: 'resend cap (' + MAX_RESENDS + ') reached' }); continue; }
    if (prior.length && (now - Math.max(...prior)) < RESEND_COOLDOWN_MS) { skipped.push({ job: jobId, why: 'resent <24h ago' }); continue; }

    // Load the job: skip terminal, get phone + warranty flag + name.
    let jd = {};
    try { jd = await fetch(`${XANO}/get_job?job_id=${jobId}`, { signal: AbortSignal.timeout(10000) }).then((x) => x.json()) || {}; } catch (_) {}
    const st = String(jd.scheduling_status || '').toLowerCase(), cst = String(jd.current_status || '').toLowerCase();
    const TERM = ['completed', 'canceled', 'cancelled', 'closed', 'no_fix_possible'];
    if (TERM.includes(st) || TERM.includes(cst)) { skipped.push({ job: jobId, why: 'status ' + (st || cst) }); continue; }
    const phone = e164(jd.customer_phone || jd.phone || (jd.customer && jd.customer.phone));
    if (!phone) { skipped.push({ job: jobId, why: 'no phone' }); continue; }
    // Shared intake cap (never let a job exceed 2 intake/outreach texts total).
    try { if (await require('./_lib/intake-cap').overCap(jobId)) { skipped.push({ job: jobId, why: 'intake cap (2) reached' }); continue; } } catch (_) {}

    const isW = !!String(jd.warranty_company || '').trim() || String(jd.customer_type || '').toLowerCase() === 'warranty';
    const first = jd.customer_first || jd.customer_first_name || (jd.customer && jd.customer.first_name) || 'there';
    const appl = jd.appliance_type ? (' ' + String(jd.appliance_type).toLowerCase()) : ' appliance';
    const link = isW ? `${SITE}/warranty-intake.html?job_id=${jobId}` : `${SITE}/finish-upload.html?job_id=${jobId}`;
    const msg = isW
      ? `Hi ${first}, TN Appliance Exchange 🐜 — looks like the video of your${appl} didn't come through (probably signal). Could you re-send it real quick? Tap ${link} — a 10-second video of what it's doing + a photo of the model-# sticker. Your repair's covered, no payment needed. Thank you!`
      : `Hi ${first}, TN Appliance Exchange 🐜 — the video of your${appl} didn't quite make it through (probably signal). Mind re-sending it? Tap ${link} — a 10-second video of the problem + a photo of the model-# sticker, and we'll get you taken care of. Thanks!`;

    if (dry) { sent.push({ job: jobId, warranty: isW, broken: brokenNow.length, preview: msg.slice(0, 80) }); continue; }
    // Claim BEFORE sending so a double-run can't double-text.
    try { await crud.logEvent('video_resend_sent', { job_id: jobId, broken_uids: brokenNow, warranty: isW, at_ms: now }); } catch (_) {}
    try { await require('./_lib/intake-cap').mark(jobId, 'video_resend'); } catch (_) {}
    try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: phone, message: msg, customer_first_name: first, context_tag: 'intake_collect' }), signal: AbortSignal.timeout(12000) }); } catch (_) {}
    sent.push({ job: jobId });
  }

  return json(200, { ok: true, mode: dry ? 'dryrun' : 'live', ct_hour: hour, minted: minted.length, jobs_checked: byJob.size, sent: sent.length, skipped: skipped.length, sent_list: sent.slice(0, 12), skipped_list: skipped.slice(0, 12) });
};
