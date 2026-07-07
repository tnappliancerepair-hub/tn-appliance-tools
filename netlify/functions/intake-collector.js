// intake-collector — the FOUNDATION for cluster ghost-scheduling.
//
// Sweeps the Needs-Scheduled board during reasonable hours and texts each
// non-vendor job (that has a phone + no availability yet) the intake request:
// when they're available, their model #, and a quick video of the problem.
// We can't cluster-schedule around availability we don't have, so this collects
// it the moment a job is sitting unscheduled.
//
// - Reasonable hours only: scheduled hourly 9am-6pm CT (netlify.toml) AND a
//   runtime CT-hour guard (8am-8pm) so it can never text at night.
// - Rate-limited (MAX_PER_RUN) so it drains the backlog over a day or two
//   without tripping the SMS circuit breaker.
// - Vendor-locked (SquareTrade/ServicePower) jobs are skipped — the vendor
//   already set their slot, they don't need availability.
// - Records availability_requested_<job> so (a) we never re-ask, and (b) the
//   customer's reply routes to the availability parser (sms_response_availability).
'use strict';
const { toE164 } = require('./_lib/sms');
const { isOptedOut } = require('./_lib/sms-guard');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const MAX_PER_RUN = Number(process.env.INTAKE_COLLECTOR_MAX_PER_RUN) || 30;
const MAX_EXAMINE = Number(process.env.INTAKE_COLLECTOR_MAX_EXAMINE) || 120; // bound dedup fetches/run
const MAX_RESOLVE = Number(process.env.INTAKE_COLLECTOR_MAX_RESOLVE) || 40;  // bound job-truth lookups/run
const RESEND_AFTER_MS = 4 * 3600 * 1000; // one resend, only if 4h passed with no reply
// Age cap is OPT-IN (Teddy: text ANY job that needs a day+time, incl. the
// backlog). 0/unset = no cap → every unscheduled job gets ONE ask, drained
// safely by the per-run rate limit + one-text dedup. Set the env to cap if ever
// needed (e.g. 14 = only jobs created in the last 14 days).
const MAX_AGE_DAYS = Number(process.env.INTAKE_COLLECTOR_MAX_AGE_DAYS) || 0;
const MAX_AGE_MS = MAX_AGE_DAYS * 86400000;
// A/B link styles — measure which one gets the most videos + availability back.
// 'video' = quick no-form upload page · 'ai' = guided AI intake · 'portal' = portal.
const AB_VARIANTS = ['video', 'ai', 'portal'];

function ctHour() {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()), 10);
}
// Midnight TODAY in CT (ms) — the cutoff for "today moving forward" scheduled jobs.
function startOfTodayCtMs() {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 5, 0, 0); // CT is UTC-5 (CDT)
}
// Midnight TOMORROW in CT (ms) — the cutoff Teddy wants: only intake people who are
// on the schedule TOMORROW moving forward (never today or the past — that ship sailed).
function startOfTomorrowCtMs() { return startOfTodayCtMs() + 86400000; }
// YYYY-MM-DD (CT) for the Monday of the week N weeks out — to page the calendar forward
// so a job scheduled early NEXT week still gets its intake link this week.
function mondayYmdCt(weeksOut) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = ymd.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const dow = base.getUTCDay();                 // 0=Sun..6=Sat
  const toMon = (dow === 0 ? -6 : 1 - dow);     // back up to this week's Monday
  base.setUTCDate(base.getUTCDate() + toMon + weeksOut * 7);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(base);
}
function first(s) { return String(s || '').trim().split(/\s+/)[0] || 'there'; }
function isVendor(w) { return /squaretrade|servicepower|service power/i.test(String(w || '')); }
async function jget(url, ms = 9000) { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.json().catch(() => ({})); }
async function jpost(url, body, ms = 9000) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); return r.json().catch(() => ({})); }
function ok(b) { return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

function maskPhone(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 4 ? '•••' + d.slice(-4) : d; }

// Resolve the customer's phone. The job's own customer_phone/phone field is often
// EMPTY on warranty dispatch jobs (the number lives on the customer record) — so fall
// back to job-truth, which resolves it the same way the office search does. This is the
// fix for "warranty customers aren't getting the intake link" (Teddy 2026-07-07): the
// phone exists, the sender just wasn't reading it from the right place.
async function resolvePhone(j) {
  let ph = String(j.customer_phone || j.phone || '').replace(/\D/g, '');
  if (ph.length >= 10) return ph;
  try {
    const id = j.id || j.job_id;
    const tr = await jget(`${SITE}/.netlify/functions/job-truth?job_id=${encodeURIComponent(id)}&lens=office`, 8000);
    const p = String((tr && tr.facts && tr.facts.customer_phone) || '').replace(/\D/g, '');
    if (p.length >= 10) return p;
  } catch (_) {}
  return '';
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dryrun = q.dryrun === '1' || q.dryrun === 'true';
  const onlyJob = q.only_job ? String(q.only_job).replace(/\D/g, '') : '';
  const force = q.force === '1' || q.force === 'true';   // bypass quiet hours for a test
  const h = ctHour();
  if (!force && !dryrun && (h < 8 || h >= 20)) return ok({ status: 'skipped_quiet_hours', ct_hour: h });

  // REGRESSION FIX (Teddy 2026-07-07: "the warranty intake just stopped"):
  // list_needs_scheduled_parallel grew to ~447 jobs and now takes ~12.3s — right
  // at the old 12s timeout, so nearly every hourly run aborted at list_failed and
  // sent ZERO intake texts. Give the full list real headroom (22s), and if it
  // still times out, FALL BACK to a smaller page (newest jobs first, ~6s) so a
  // growing board can never silently kill the funnel again.
  // SCOPE (Teddy 2026-07-07): "We only need intake stuff for anybody on our schedule
  // TOMORROW moving forward, plus anybody unscheduled — not going back." So we source
  // ONLY from the office calendar (curated, real jobs), NOT list_needs_scheduled_parallel
  // (which had ballooned to ~447 mostly-dead SquareTrade claim-shells — that stale
  // backlog is exactly the "185" we do NOT want to text). Two clean buckets:
  //   1. SCHEDULED tomorrow-forward  (cal.jobs where scheduled_start >= start of tomorrow)
  //   2. UNSCHEDULED, active         (cal.unscheduled — the real ready-to-schedule set)
  // We page this week + next week so a job scheduled early next week still gets its link.
  let items = [];
  let sched_added = 0, unsched_added = 0;
  const tomorrowStart = startOfTomorrowCtMs();
  const seen = new Set();
  const pushJob = (j, kind) => {
    const id = String(j.id || j.job_id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    j.customer_first = j.customer_first || j.customer_first_name || '';
    j.appliance = j.appliance || j.appliance_type || '';
    items.push(j);
    if (kind === 'sched') sched_added++; else unsched_added++;
  };
  try {
    for (const w of [0, 1]) {   // this week + next week
      const qs = w === 0 ? '' : `?week_start=${mondayYmdCt(w)}`;
      const cal = await jget(`${XANO}/get_office_calendar_week${qs}`, 15000);
      for (const j of (cal.jobs || [])) {
        if (Number(j.scheduled_start || 0) < tomorrowStart) continue;   // TOMORROW forward only
        pushJob(j, 'sched');
      }
      // unscheduled is a global ready-to-schedule set (not week-bound) — only take it once.
      if (w === 0) for (const j of (cal.unscheduled || [])) pushJob(j, 'unsched');
    }
  } catch (e2) { return ok({ status: 'list_failed', error: String((e2 && e2.message) || e2) }); }

  // Candidates: non-vendor, has a phone, no availability captured yet.
  const cands = items.filter((j) => {
    // Teddy 2026-07-01: send to EVERYBODY — warranty (AHS + SquareTrade) and
    // non-warranty. Vendor jobs get a LIGHTER message (below), but they're no
    // longer skipped — availability + "tell us if your part comes sooner" is
    // hugely helpful across the board.
    // NOTE: we no longer exclude jobs with an empty phone FIELD here — warranty jobs
    // carry the number on the customer record, resolved via job-truth in the send loop.
    // Never chase a job flagged for a human to look at — "Email captured — needs
    // review" is a stale warranty claim-update, not a live intake. Auto-texting
    // these is exactly how a completed customer (Kurt #19475) kept getting
    // "let's get you scheduled" texts weeks later. (Teddy 2026-07-02)
    const fs = String(j.friendly_status || '').toLowerCase();
    if (/needs review|email captured/.test(fs)) return false;
    // Optional age cap (off by default → ANY unscheduled job gets one ask).
    if (MAX_AGE_MS > 0) {
      const created = new Date(j.created_at || 0).getTime();
      if (created && (Date.now() - created) > MAX_AGE_MS) return false;
    }
    const hasAvail = !!((j.customer_preference_text || '').trim() || (j.customer_availability_grid || '').trim());
    if (hasAvail) return false;
    // Skip stale SquareTrade claim-shells: no phone field AND no name AND no appliance =
    // unreachable, and only waste a job-truth lookup. (Anything with a name/appliance is
    // worth a job-truth resolve.)
    const hasPhoneField = String(j.customer_phone || j.phone || '').replace(/\D/g, '').length >= 10;
    const hasName = !!String(j.customer_first || j.customer_name || j.first_name || '').trim();
    const hasAppl = !!String(j.appliance || j.appliance_type || '').trim();
    if (!hasPhoneField && !hasName && !hasAppl) return false;
    if (onlyJob && String(j.id || j.job_id) !== onlyJob) return false; // target one job for a test
    return true;
  });

  function linkFor(j, id) {
    const isW = !!String(j.warranty_company || '').trim() || String(j.customer_type || '').toLowerCase() === 'warranty';
    return { isW, vlink: isW ? `${SITE}/warranty-intake.html?job_id=${id}` : `${SITE}/appliance-ai.html?job_id=${id}&mode=resume` };
  }

  // Dry run: show exactly who WOULD be texted, with the phone RESOLVED (job field or
  // job-truth), so Teddy can see the real numbers before anything sends. No writes.
  if (dryrun) {
    const preview = [];
    for (const j of cands.slice(0, 15)) {
      const id = j.id || j.job_id;
      const fieldHad = String(j.customer_phone || j.phone || '').replace(/\D/g, '').length >= 10;
      const phoneDigits = await resolvePhone(j);
      const { isW, vlink } = linkFor(j, id);
      preview.push({ job_id: id, first: first(j.customer_first), appliance: (j.appliance || 'appliance'),
        type: isW ? (j.warranty_company || 'warranty') : 'cash',
        to: phoneDigits ? maskPhone(phoneDigits) : '❌ NO PHONE',
        phone_source: fieldHad ? 'job' : (phoneDigits ? 'job-truth ✓' : 'none'), link: vlink });
    }
    return ok({ status: 'dryrun', ct_hour: h, total_pool: items.length, scheduled_tomorrow_forward: sched_added, unscheduled_active: unsched_added, candidates: cands.length,
      note: `first 15 of ${cands.length} candidates shown; each live run resolves phones + sends up to ${MAX_PER_RUN}`, would_text: preview });
  }

  // SHARED 2-CAP (Teddy 2026-07-07: "No more than two each customer for intake").
  // The loop's greeting + nudges write a shared 'intake_outreach_sent' marker; the
  // collector writes its own 'availability_requested_<job>'. Neither saw the other, so a
  // customer could get greeting(1) + collector(2) = 3. Fix: count the loop's sends too
  // (one fetch, mapped per job) and add them to the collector's own count → hard 2 total.
  // The collector also writes 'intake_outreach_sent' on each send (below) so the LOOP's
  // own cap counts collector sends. Loop actions only (via != intake_collector) so the
  // collector's own sends aren't double-counted against its availability_requested count.
  const LOOP_VIAS = new Set(['new_job_greeting', 'availability_nudge', 'availability_request', 'resume_nudge']);
  const loopIntakeByJob = {};
  try {
    const lr = await jget(`${XANO}/list_recent_event_log?action=intake_outreach_sent&days_back=120&limit=2000`, 12000);
    for (const r of (lr.items || [])) {
      let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
      m = m || {};
      const jid = String(m.job_id || '');
      if (!jid) continue;
      if (m.source === 'intake_collector') continue;         // collector's own — counted via availability_requested
      if (m.via && !LOOP_VIAS.has(String(m.via))) continue;  // only real loop intake touches
      loopIntakeByJob[jid] = (loopIntakeByJob[jid] || 0) + 1;
    }
  } catch (_) { /* fail open — per-job availability_requested cap still guards */ }

  let sent = 0, skipped_dupe = 0, skipped_no_phone = 0, resolved_via_truth = 0, resolves = 0, examined = 0, failed = 0;
  const done = [];
  for (const j of cands) {
    if (sent >= MAX_PER_RUN) break;
    if (examined++ >= MAX_EXAMINE) break;   // keep the run inside the function budget
    const id = j.id || j.job_id;
    // Dedup FIRST (cheap) so we don't job-truth a job we've already asked. ONE intake
    // text, then ONE resend ~4h later if no reply, then never (2 lifetime max). A reply
    // sets availability → the candidate filter drops it. FAIL CLOSED on read error.
    let asks = [];
    try {
      const dd = await jget(`${XANO}/list_recent_event_log?action=availability_requested_${id}&days_back=3650&limit=5`, 7000);
      asks = dd.items || [];
    } catch (_) { skipped_dupe++; continue; }
    // TOTAL intake to this customer = collector's own asks + the loop's greeting/nudges.
    // Hard cap at 2 across both senders (Teddy: "No more than two each customer").
    const priorIntake = asks.length + (loopIntakeByJob[String(id)] || 0);
    if (priorIntake >= 2) { skipped_dupe++; continue; }
    if (asks.length === 1) {
      const lastMs = Math.max(...asks.map((a) => new Date(a.created_at).getTime() || 0));
      if (Date.now() - lastMs < RESEND_AFTER_MS) { skipped_dupe++; continue; }
    }
    // Resolve the phone — job field, or job-truth (where the warranty number lives).
    const fieldDigits = String(j.customer_phone || j.phone || '').replace(/\D/g, '');
    const fieldHad = fieldDigits.length >= 10;
    if (!fieldHad && resolves >= MAX_RESOLVE) { skipped_no_phone++; continue; } // bound expensive lookups/run
    if (!fieldHad) resolves++;
    const phoneDigits = fieldHad ? fieldDigits : await resolvePhone(j);
    if (phoneDigits.length < 10) { skipped_no_phone++; continue; }
    if (!fieldHad) resolved_via_truth++;
    const phone = toE164(phoneDigits);
    // Honor STOP — a customer who opted out never gets a chase text. (Teddy 2026-07-02)
    try { if (await isOptedOut(phone)) { skipped_dupe++; continue; } } catch (_) {}

    // Claim BEFORE sending (optimistic lock) so a parallel run never double-texts.
    let claimed = false;
    try { const mr = await jpost(`${XANO}/record_event_log`, { action: `availability_requested_${id}`, metadata_json: JSON.stringify({ job_id: id, source: 'intake_collector', send_no: asks.length + 1, at_ms: Date.now() }) }); claimed = !!(mr && (mr.success || mr.id || mr.ok || typeof mr === 'object')); } catch (_) {}
    if (!claimed) { skipped_dupe++; continue; }

    const cust = first(j.customer_first);
    const appl = (j.appliance || 'appliance');
    // WARRANTY customers get the warranty-intake light page (video + model + days +
    // waiver, no payer question); CASH customers stay on the old intake flow.
    const { isW, vlink } = linkFor(j, id);
    // Warranty intake pitch: same points as the greeting — video (their words), model
    // photo (so we know the machine), days, and a quick waiver → pre-diagnose + right
    // part + one trip. (Teddy 2026-07-07.)
    const msg = isW
      ? `Hi ${cust} — TN Appliance Exchange 🐜. Your ${appl} repair is covered by your home warranty, no payment needed. Quickest way to get fixed: tap ${vlink} (about 2 min) — a 10-second video of what it's doing in your own words, a photo of the model-number sticker, tap the days that work for you, and sign a quick waiver. It lets us pre-diagnose it and bring the right part so we fix it in one trip. Thank you!`
      : `Hi ${cust} — TN Appliance Exchange 🐜. Let's get your ${appl} fixed fast. Tap ${vlink} — takes 2 minutes: a 10-second video, a photo of the model sticker (so your tech rolls up with the right part), and tap the days that work for you. That's it — thank you!`;

    let okSend = false;
    try { const r = await jpost(`${XANO}/send_sms`, { to: phone, message: msg, context_tag: 'intake_collect_light' }); okSend = !!(r && r.success); } catch (_) {}
    if (okSend) {
      sent++; done.push(id);
      try { await jpost(`${XANO}/record_event_log`, { action: 'intake_light_sent', metadata_json: JSON.stringify({ job_id: id, phone: maskPhone(phone), at_ms: Date.now() }) }); } catch (_) {}
      // Write the SHARED intake marker too so the LOOP's own 2-cap counts this send
      // (via:'intake_collector' keeps it out of our own loop-count above → no double count).
      try { await jpost(`${XANO}/record_event_log`, { action: 'intake_outreach_sent', metadata_json: JSON.stringify({ job_id: id, source: 'intake_collector', via: 'intake_collector', at_ms: Date.now() }) }); } catch (_) {}
    } else failed++;
  }

  return ok({ status: 'ran', ct_hour: h, candidates: cands.length, scheduled_tomorrow_forward: sched_added, unscheduled_active: unsched_added, examined, sent, skipped_dupe, skipped_no_phone, resolved_via_truth, failed, job_ids: done });
};
