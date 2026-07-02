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
const RESEND_AFTER_MS = 4 * 3600 * 1000; // one resend, only if 4h passed with no reply
// Age cap is OPT-IN (Teddy: text ANY job that needs a day+time, incl. the
// backlog). 0/unset = no cap → every unscheduled job gets ONE ask, drained
// safely by the per-run rate limit + one-text dedup. Set the env to cap if ever
// needed (e.g. 14 = only jobs created in the last 14 days).
const MAX_AGE_DAYS = Number(process.env.INTAKE_COLLECTOR_MAX_AGE_DAYS) || 0;
const MAX_AGE_MS = MAX_AGE_DAYS * 86400000;

function ctHour() {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()), 10);
}
function first(s) { return String(s || '').trim().split(/\s+/)[0] || 'there'; }
function isVendor(w) { return /squaretrade|servicepower|service power/i.test(String(w || '')); }
async function jget(url, ms = 9000) { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.json().catch(() => ({})); }
async function jpost(url, body, ms = 9000) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); return r.json().catch(() => ({})); }
function ok(b) { return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

function maskPhone(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 4 ? '•••' + d.slice(-4) : d; }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const dryrun = q.dryrun === '1' || q.dryrun === 'true';
  const onlyJob = q.only_job ? String(q.only_job).replace(/\D/g, '') : '';
  const force = q.force === '1' || q.force === 'true';   // bypass quiet hours for a test
  const h = ctHour();
  if (!force && !dryrun && (h < 8 || h >= 20)) return ok({ status: 'skipped_quiet_hours', ct_hour: h });

  let items = [];
  try {
    const d = await jget(`${XANO}/list_needs_scheduled_parallel?limit=1000`, 12000);
    items = d.items || d.jobs || d.rows || (Array.isArray(d) ? d : []);
  } catch (e) { return ok({ status: 'list_failed', error: String(e.message || e) }); }

  // Candidates: non-vendor, has a phone, no availability captured yet.
  const cands = items.filter((j) => {
    // Teddy 2026-07-01: send to EVERYBODY — warranty (AHS + SquareTrade) and
    // non-warranty. Vendor jobs get a LIGHTER message (below), but they're no
    // longer skipped — availability + "tell us if your part comes sooner" is
    // hugely helpful across the board.
    const ph = String(j.customer_phone || j.phone || '').replace(/\D/g, '');
    if (ph.length < 10) return false;
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
    if (onlyJob && String(j.id || j.job_id) !== onlyJob) return false; // target one job for a test
    return true;
  });

  // Dry run: show exactly who WOULD be texted + a message preview. No sends, no
  // dedup markers written. Safe to hit anytime to verify the logic.
  if (dryrun) {
    return ok({
      status: 'dryrun', ct_hour: h, total_needs_scheduled: items.length, candidates: cands.length,
      would_text: cands.slice(0, 10).map((j) => {
        const id = j.id || j.job_id;
        const cust = first(j.customer_first);
        const appl = (j.appliance || 'appliance');
        return { job_id: id, to: maskPhone(j.customer_phone || j.phone), first: cust, appliance: appl, portal: `${SITE}/customer-portal.html?job_id=${id}&last4=`, message_preview: `Hi ${cust} — TN Appliance Exchange 🐜. Two quick things to get your ${appl} fixed fast: 1) send a short video + model sticker photo  2) reply with the days that work…` };
      }),
    });
  }

  let sent = 0, skipped_dupe = 0, failed = 0;
  const done = [];
  for (const j of cands) {
    if (sent >= MAX_PER_RUN) break;
    const id = j.id || j.job_id;
    // ONE intake text, then at most ONE resend ~4h later if still no reply, then
    // never again (Teddy 2026-06-23: "send it once, maybe twice if no answer").
    // The candidate filter already drops jobs that have availability, so a reply
    // stops the resend. FAIL CLOSED: if we can't verify history, skip.
    // Honor STOP on THIS path too (the loop/Xano send_sms aren't all behind the
    // guard yet). A customer who opted out never gets a chase text. (Teddy 2026-07-02)
    try { if (await isOptedOut(toE164(j.customer_phone || j.phone))) { skipped_dupe++; continue; } } catch (_) {}
    let asks = [];
    try {
      // LIFETIME dedup window (was 30d — after a month it rolled and re-sent 2 more,
      // which is why Kurt got texts for weeks). 2 asks is now the true lifetime max.
      const dd = await jget(`${XANO}/list_recent_event_log?action=availability_requested_${id}&days_back=3650&limit=5`, 7000);
      asks = dd.items || [];
    } catch (_) { skipped_dupe++; continue; }
    if (asks.length >= 2) { skipped_dupe++; continue; }            // already sent the max (2), ever
    if (asks.length === 1) {
      const lastMs = Math.max(...asks.map((a) => new Date(a.created_at).getTime() || 0));
      if (Date.now() - lastMs < RESEND_AFTER_MS) { skipped_dupe++; continue; } // too soon to resend
    }

    // Claim BEFORE sending (optimistic lock) so parallel invocations + the next
    // run see the marker immediately and never double-text.
    let claimed = false;
    try { const mr = await jpost(`${XANO}/record_event_log`, { action: `availability_requested_${id}`, metadata_json: JSON.stringify({ job_id: id, source: 'intake_collector', send_no: asks.length + 1, at_ms: Date.now() }) }); claimed = !!(mr && (mr.success || mr.id || mr.ok || typeof mr === 'object')); } catch (_) {}
    if (!claimed) { skipped_dupe++; continue; }

    const phone = toE164(j.customer_phone || j.phone);   // send_sms needs E.164, not bare digits
    const cust = first(j.customer_first);
    const appl = (j.appliance || 'appliance');
    const portal = `${SITE}/customer-portal.html?job_id=${id}&last4=`;
    // One message for everybody (Teddy 2026-07-01): if they already have a time
    // that's fine, but the more open they are the sooner we may get to them.
    const msg = `Hi ${cust} — TN Appliance Exchange 🐜. We've got your ${appl} repair. If you already have a time set, that's totally fine! But if you're more open, let us know — we may be able to get to you sooner. Just take a couple minutes to reply here with the days/times that work for you, and any days you can't do (or tap: ${portal}). It really helps us — thank you!`;

    let okSend = false;
    try { const r = await jpost(`${XANO}/send_sms`, { to: phone, message: msg, context_tag: 'intake_collect' }); okSend = !!(r && r.success); } catch (_) {}
    if (okSend) { sent++; done.push(id); } else failed++;
  }

  return ok({ status: 'ran', ct_hour: h, candidates: cands.length, sent, skipped_dupe, failed, job_ids: done });
};
