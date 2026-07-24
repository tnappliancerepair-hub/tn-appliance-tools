// intake-link-guarantee — THE guarantee (Teddy 2026-07-24: "every job that we
// receive in must receive the intake link"). This is the safety net that makes
// that TRUE, independent of the Mac loop and independent of any Xano push.
//
// WHY THIS EXISTS — two failures were leaving new jobs with NO intake link:
//   1. The loop's instant greeting was gated off (empty context_tag) — it never
//      reached the customer.
//   2. WORSE: job_created.js writes `availability_requested_<id>` (source:'greeting')
//      even when that send was BLOCKED, so the hourly intake-collector — which skips
//      any job that already has that marker — then skips exactly the blocked jobs.
//      They go permanently dark. (Proven live on job 20745, Linda's fridge.)
//
// This sweep reads the LIVE board, and for every reachable, non-terminal, recently
// received job that has NOT actually been sent a link, it sends the intake link ONCE,
// from the approved line, tagged `intake_collect` (clears the send_sms gate TODAY — no
// push needed) with the intake link in the body (clears it post-push too). It composes
// with the collector by only trusting a REAL send marker (source:'intake_collector' or
// this sweep's own `intake_link_guaranteed_<id>`) — never the loop's poisoned greeting
// marker. Duplicate dispatch ROWS collapse to one send per (phone + claim/appliance).
//
//   GET ?probe=1                     -> board size + reachable + would-send (no writes)
//   GET ?dryrun=1                    -> exactly who WOULD get it, phones resolved (no send)
//   GET ?live=1&secret=<admin>       -> send this run
//   Scheduled cron                   -> sends live unless env INTAKE_GUARANTEE_LIVE=false
'use strict';
const { toE164 } = require('./_lib/sms');
const { isOptedOut } = require('./_lib/sms-guard');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const PER_RUN_CAP = Number(process.env.INTAKE_GUARANTEE_MAX_PER_RUN) || 40;
const MAX_EXAMINE = Number(process.env.INTAKE_GUARANTEE_MAX_EXAMINE) || 160;
const MAX_RESOLVE = Number(process.env.INTAKE_GUARANTEE_MAX_RESOLVE) || 60;
// "Received in" = recently arrived. A job created weeks ago already had its shot; this
// guarantees the INCOMING stream, and scoping to recent bounds the sweep so it can never
// re-text the whole historical board. Upcoming-scheduled jobs are always in scope too.
const RECENT_DAYS = Number(process.env.INTAKE_GUARANTEE_RECENT_DAYS) || 6;
const RECENT_MS = RECENT_DAYS * 86400000;
const TERMINAL = new Set(['completed', 'complete', 'canceled', 'cancelled', 'done', 'closed', 'no_fix_possible', 'not_needed']);

function ctHour() { try { return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()), 10) || 0; } catch (_) { return 12; } }
function ok(b) { return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function first(s) { return String(s || '').trim().split(/\s+/)[0] || 'there'; }
function mask(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 4 ? '•••' + d.slice(-4) : d; }
async function jget(url, ms = 9000) { try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return await r.json(); } catch (_) { return {}; } }
async function jpost(url, body, ms = 9000) { try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); return await r.json(); } catch (_) { return {}; } }

async function boardJobs() {
  const d = await jget(`${XANO}/get_office_kanban`, 15000);
  return (Array.isArray(d) ? d : (d.jobs || d.items || d.rows || [])) || [];
}

// Phone lives on the job field for cash, on the customer record for warranty (resolved
// via job-truth, exactly like the office search + the collector).
async function resolvePhone(j) {
  let ph = String(j.customer_phone || j.phone || '').replace(/\D/g, '');
  if (ph.length >= 10) return ph;
  try {
    const tr = await jget(`${SITE}/.netlify/functions/job-truth?job_id=${encodeURIComponent(j.id || j.job_id)}&lens=office`, 8000);
    const p = String((tr && tr.facts && tr.facts.customer_phone) || '').replace(/\D/g, '');
    if (p.length >= 10) return p;
  } catch (_) {}
  return '';
}

function linkFor(j, id) {
  const isW = !!String(j.warranty_company || '').trim() || String(j.customer_type || '').toLowerCase() === 'warranty';
  return { isW, link: isW ? `${SITE}/warranty-intake.html?job_id=${id}` : `${SITE}/appliance-ai.html?job_id=${id}&mode=resume` };
}
function intakeMsg(cust, appl, link, isW) {
  return isW
    ? `Hi ${cust}! 🐜 TN Appliance — your ${appl} repair is covered, no charge. Two quick things and we've got you: (1) a 10-second video of your ${appl} doing — or NOT doing — its thing, and (2) a photo of the model-number sticker. That's how we bring the right part for YOUR machine. Tap ${link} — about a minute. 🙌`
    : `Hi ${cust}! 🐜 TN Appliance — let's get your ${appl} fixed fast. Two quick things: (1) a 10-second video of what it's doing, and (2) a photo of the model-number sticker — that's how we bring the right part. Tap ${link} + pick your days. About 2 min. 🙌`;
}

// Was this job ALREADY sent a real intake link? Trust only a real-send marker:
// the collector (source:'intake_collector') or this sweep's own guarantee marker.
// NEVER the loop's `source:'greeting'` marker — that's written even on a blocked send.
async function realIntakeSent(id) {
  const [av, gu] = await Promise.all([
    jget(`${XANO}/list_recent_event_log?action=availability_requested_${id}&days_back=3650&limit=8`, 7000),
    jget(`${XANO}/list_recent_event_log?action=intake_link_guaranteed_${id}&days_back=3650&limit=2`, 6000),
  ]);
  if ((gu.items || []).length) return true;
  for (const it of (av.items || [])) {
    let m = it.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    if (m && m.source === 'intake_collector') return true;   // a REAL collector send
  }
  return false;
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const ADMIN = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const scheduled = !!(event && event.body && (() => { try { return JSON.parse(event.body).next_run; } catch (_) { return false; } })());
  const now = Date.now();
  const h = ctHour();

  const dryrun = q.dryrun === '1' || q.dryrun === 'true';
  const probe = q.probe === '1' || q.probe === 'true';
  const liveEnv = String(process.env.INTAKE_GUARANTEE_LIVE || 'true').toLowerCase() !== 'false';
  const live = q.live === '1' ? (q.secret === ADMIN) : (scheduled && liveEnv);

  const raw = await boardJobs();
  // Reachable, non-terminal, recently received (or upcoming). Skip dead SquareTrade shells
  // (no name AND no appliance = unreachable claim husk).
  const inScope = raw.filter((j) => {
    const st = String(j.scheduling_status || j.current_status || '').toLowerCase();
    if (TERMINAL.has(st)) return false;
    const name = String(j.customer_first || j.customer_name || '').trim();
    const appl = String(j.appliance || j.appliance_type || '').trim();
    if (!name && !appl) return false;
    const created = Number(j.created_at || 0);
    const sched = Number(j.scheduled_start || 0);
    const recent = (created && now - created <= RECENT_MS) || (sched && sched >= now - 43200000);
    return !!recent;
  });

  if (probe) {
    return ok({ status: 'probe', ct_hour: h, board_total: raw.length, in_scope_recent: inScope.length,
      note: `recent = created within ${RECENT_DAYS}d OR upcoming; each live run sends up to ${PER_RUN_CAP}` });
  }

  // Business-hours guard for real sends (dry/probe exempt).
  if (live && (h < 8 || h >= 20)) return ok({ status: 'skipped_quiet_hours', ct_hour: h, in_scope_recent: inScope.length });

  let sent = 0, examined = 0, resolves = 0, skipped_engaged = 0, skipped_already = 0, skipped_no_phone = 0, skipped_optout = 0, skipped_dupe = 0, failed = 0;
  const runDedup = new Set();   // (phone + claim/appliance) collapses duplicate dispatch rows
  const preview = [], done = [];

  for (const j of inScope) {
    if (sent >= PER_RUN_CAP) break;
    if (examined++ >= MAX_EXAMINE) break;
    const id = j.id || j.job_id;

    // Engaged already? availability filled = they replied = they DID get a text. Skip.
    if (String(j.customer_preference_text || '').trim()) { skipped_engaged++; continue; }

    // Real prior send (collector or this sweep)? Skip. (Loop's blocked 'greeting' marker ignored.)
    if (await realIntakeSent(id)) { skipped_already++; continue; }

    // Media on file = engaged (sent the video already). Skip nagging them.
    try { const stt = await jget(`${XANO}/get_unified_tdr_status?job_id=${id}`, 7000); if (stt && (stt.has_photo || Number(stt.attachments_count || 0) > 0)) { skipped_engaged++; continue; } } catch (_) {}

    const fieldDigits = String(j.customer_phone || j.phone || '').replace(/\D/g, '');
    const fieldHad = fieldDigits.length >= 10;
    if (!fieldHad && resolves >= MAX_RESOLVE) { skipped_no_phone++; continue; }
    if (!fieldHad) resolves++;
    const digits = fieldHad ? fieldDigits : await resolvePhone(j);
    if (digits.length < 10) { skipped_no_phone++; continue; }
    const phone = toE164(digits);

    // Collapse duplicate dispatch rows: one link per (phone + claim || appliance).
    const dkey = phone + '|' + (String(j.claim_number || '').trim() || String(j.appliance || j.appliance_type || '').trim().toLowerCase());
    if (runDedup.has(dkey)) { skipped_dupe++; continue; }

    try { if (await isOptedOut(phone)) { skipped_optout++; continue; } } catch (_) {}

    const { isW, link } = linkFor(j, id);
    const msg = intakeMsg(first(j.customer_first), (j.appliance || j.appliance_type || 'appliance'), link, isW);

    if (dryrun) {
      runDedup.add(dkey);
      preview.push({ job_id: id, first: first(j.customer_first), appliance: (j.appliance || j.appliance_type || 'appliance'), type: isW ? (j.warranty_company || 'warranty') : 'cash', to: mask(phone), phone_source: fieldHad ? 'job' : 'job-truth ✓', link });
      sent++;   // count as "would send" against the cap for a realistic preview
      continue;
    }

    // Claim BEFORE sending (per-job marker) so a parallel run never double-texts.
    runDedup.add(dkey);
    await jpost(`${XANO}/record_event_log`, { action: `intake_link_guaranteed_${id}`, metadata_json: JSON.stringify({ job_id: id, phone_e164: phone, dedup_key: dkey, source: 'intake_guarantee', at_ms: Date.now() }) });

    // Send. Tag intake_collect => clears the send_sms intake gate TODAY; the intake link
    // in the body clears it post-push too. Belt and suspenders.
    let okSend = false;
    try { const r = await jpost(`${XANO}/send_sms`, { to: phone, message: msg, context_tag: 'intake_collect' }); okSend = !!(r && r.success); } catch (_) {}
    if (okSend) {
      sent++; done.push(id);
      // Phone-keyed marker so the collector's phone-cap + overtexting-watch also count this.
      try { await jpost(`${XANO}/record_event_log`, { action: 'intake_light_sent', metadata_json: JSON.stringify({ job_id: id, phone_e164: phone, source: 'intake_guarantee', at_ms: Date.now() }) }); } catch (_) {}
    } else failed++;
  }

  if (dryrun) return ok({ status: 'dryrun', ct_hour: h, board_total: raw.length, in_scope_recent: inScope.length, would_send: sent, examined, skipped_engaged, skipped_already, skipped_no_phone, skipped_optout, skipped_dupe, preview: preview.slice(0, 25) });
  if (!live) return ok({ status: 'idle', ct_hour: h, board_total: raw.length, in_scope_recent: inScope.length, note: 'add ?dryrun=1 to preview, ?live=1&secret= to send, or let the cron run (INTAKE_GUARANTEE_LIVE!=false)' });
  return ok({ status: 'ran', ct_hour: h, board_total: raw.length, in_scope_recent: inScope.length, sent, examined, skipped_engaged, skipped_already, skipped_no_phone, skipped_optout, skipped_dupe, failed, job_ids: done });
};
