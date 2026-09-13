// platform-warranty-tee — feeds NEW warranty dispatch emails onto the platform board.
//
// The productized intake path is the Cloudflare Email Worker on jobs.assistant247.net
// (a shop forwards to <slug>@jobs.assistant247.net). That pipe isn't deployed yet, so
// this tee is the no-Cloudflare bridge for TN's cutover: it reads the dispatch emails
// that already land in TN's Gmail (the same ones the legacy Xano pollers read), and POSTs
// each to platform-email-intake as <slug>@jobs.assistant247.net — so the SAME dispatch
// lands on BOTH the platform board AND Xano (true parallel run; Gmail reads are
// non-destructive, so the legacy system is untouched).
//
// Idempotent: platform-email-intake dedupes per (company, message_id) BEFORE it parses,
// so re-scanning a rolling window every cron tick is cheap (a single DB lookup for
// already-seen mail). We key message_id off the stable Gmail message id.
//
//   GET ?secret=<admin>[&dryrun=1]   (dryrun lists what WOULD land, sends nothing)
//   Backfill params (manual only - the cron passes none, so its behavior is unchanged):
//     &days=N      widen the window to N days. WINS over the vault query so a one-off
//                  replay never has to touch the key the 15-min cron reads.
//     &subject=... narrow to ONE vendor's subject for a bounded replay.
//     &max=N       per-inbox cap (default 40, ceiling 200). readMany's max is PER-ACCOUNT.
//     &budget_ms=N wall-clock budget for the intake loop (default 20000).
//   For a real backfill call platform-warranty-tee-background instead: a 4-inbox
//   full-format Gmail read can consume a sync function's whole allowance by itself.
//     &q=...       raw Gmail query, outranks everything. Gmail returns NEWEST-first and
//                  &max truncates the oldest, so a long backfill must be walked in SLICES
//                  with both bounds (after:.. before:..) - a bigger &max alone times out.
//   A replay is safe: intake dedupes per (company, message_id) pre-parse, and a job-level
//   dedup now FILLS BLANKS on the existing card rather than discarding the dispatch.
//   Kill switch: vault PLATFORM_WARRANTY_TEE_ENABLED=false
//   Tunables (vault): PLATFORM_WARRANTY_TEE_SLUG (default tn-appliance-exchange-llc),
//     PLATFORM_WARRANTY_TEE_WINDOW_HOURS (default 3), PLATFORM_WARRANTY_TEE_SUBJECT
//     (default "New Dispatch Notification"), or PLATFORM_WARRANTY_TEE_QUERY to fully
//     override the Gmail query.
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { readMany } = require('./_lib/gmail-accounts');
const intake = require('./platform-email-intake');

const SLUG_DEFAULT = 'tn-appliance-exchange-llc';

// THE WHOLE WARRANTY BOOK, not just Frontdoor.
//
// This tee shipped matching one subject -- Frontdoor's "New Dispatch Notification" -- so
// that is the only vendor whose dispatches were reaching the platform. Measured
// 2026-09-12 against the cutover check: SquareTrade is 60% of TN's warranty work and NSA
// another 13%, and BOTH were arriving only in Xano. 72% of the work had no platform copy,
// which is the real reason the board still originates almost nothing (13 jobs born here
// against 3,465 mirrored in).
//
// Each clause was verified against 30 days of real mail before it went in:
//   SquareTrade -> from:servicepower.com + subject "Service Request Notice"  (the dispatch)
//   NSA         -> subject "NSA Dispatch for ..."                            (34 in 30d)
//   Frontdoor   -> subject "New Dispatch Notification #..."                  (unchanged)
//
// TWO THINGS LEARNED DOING THAT, both of which would have silently broken this:
//
// 1. NSA sends from notifications@em.nationalservicealliance.com and Gmail will NOT match
//    that with from:em.nationalservicealliance.com -- it returns zero. The subject is
//    distinctive enough to stand alone, so NSA is matched on subject only. Do not "tidy"
//    this by adding a from: clause; it silently drops every NSA dispatch.
//
// 2. The exclusions are load-bearing. "Service Request Notice Cancellation" contains the
//    dispatch subject as a substring, and NSA sends "Update Request" / "Update Needed"
//    mail that is not a dispatch. Creating jobs from notification mail is exactly how the
//    Xano side ended up with ~406 junk shells ("Dispatch Cancelled [#...]"). Anything
//    added here needs the same read-the-real-mail check.
//
// Deliberately NOT included: bare "Service Request" (ambiguous) and ServicePower's
// "SERVICER NEW NOTES" / status / payment mail (not dispatches).
const DISPATCH_QUERY =
  '-in:sent ((from:servicepower.com subject:"Service Request Notice")' +
  ' OR subject:"NSA Dispatch for"' +
  ' OR subject:"New Dispatch Notification")' +
  ' -subject:Cancellation -subject:Cancelled -subject:Canceled' +
  ' -subject:"Update Request" -subject:"Update Needed"';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function runTee(dry, opts) {
  const o = opts || {};
  // A wall-clock budget, because the Gmail full-format read can eat most of a sync
  // function's allowance on its own and leave the intake loop to be KILLED mid-batch.
  // A killed run exits as a network fault with no record of how far it got. Stopping
  // cleanly and reporting `remaining` is the difference between a resumable backfill
  // and a silent partial write. Background callers pass a much larger budget.
  const t0 = Date.now();
  const budgetMs = Math.max(3000, parseInt(o.budgetMs || '20000', 10) || 20000);
  // getSecretFresh so a vault tuning change (window/kill switch/slug) takes effect on the
  // next run instead of waiting for the warm container to recycle.
  const enabled = String((await getSecretFresh('PLATFORM_WARRANTY_TEE_ENABLED')) || 'true').toLowerCase() !== 'false';
  if (!dry && !enabled) return { ok: true, disabled: true, note: 'PLATFORM_WARRANTY_TEE_ENABLED=false' };

  const slug = (await getSecretFresh('PLATFORM_WARRANTY_TEE_SLUG')) || SLUG_DEFAULT;
  const toAddr = slug + '@jobs.assistant247.net';
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const emailSecret = (await getSecret('PLATFORM_EMAIL_SECRET')) || admin;

  // An explicit &days= / &subject= is a deliberate manual backfill, so it outranks the vault
  // query. Without either param this is byte-identical to before (the cron passes neither).
  let query = '';
  if (o.q) {
    query = String(o.q);
  } else if (o.days || o.subject) {
    const d = Math.max(1, Math.min(365, parseInt(o.days || '1', 10) || 1));
    const after = Math.floor(Date.now() / 1000) - d * 86400;
    query = o.subject
      ? `after:${after} -in:sent subject:"${String(o.subject).replace(/"/g, '')}"`
      : `after:${after} ${DISPATCH_QUERY}`;
  } else {
    query = (await getSecretFresh('PLATFORM_WARRANTY_TEE_QUERY')) || '';
  }
  if (!query) {
    // Default window 6h — a 15-min cron catches every new dispatch well inside it, and a
    // few missed cron cycles can't drop mail. Re-scans are cheap (intake dedupes pre-parse).
    const hrs = parseInt((await getSecretFresh('PLATFORM_WARRANTY_TEE_WINDOW_HOURS')) || '6', 10) || 6;
    const after = Math.floor(Date.now() / 1000) - hrs * 3600;   // Gmail accepts epoch-seconds in after:
    // A SUBJECT override still narrows to one vendor for a test; with none set we take the
    // whole book. PLATFORM_WARRANTY_TEE_QUERY (above) still overrides everything.
    const subject = (await getSecretFresh('PLATFORM_WARRANTY_TEE_SUBJECT')) || '';
    query = subject
      ? `after:${after} -in:sent subject:"${subject}"`
      : `after:${after} ${DISPATCH_QUERY}`;
  }

  let msgs = [];
  const max = Math.max(1, Math.min(200, parseInt(o.max || '40', 10) || 40));
  try { msgs = await readMany(query, { max }); } catch (e) { return { ok: false, error: 'gmail read failed: ' + String((e && e.message) || e) }; }

  const out = { ok: true, dry: !!dry, slug, query, max, scanned: msgs.length, created: 0, deduped: 0, skipped: 0, enriched: 0, fields_filled: 0, results: [] };
  let idx = 0;
  for (const m of msgs) {
    idx++;
    if (Date.now() - t0 > budgetMs) {
      out.stopped_on_budget = true;
      out.remaining = msgs.length - (idx - 1);
      break;
    }
    const brief = { id: m.id, from: String(m.from || '').slice(0, 44), subject: String(m.subject || '').slice(0, 60) };
    if (dry) { out.results.push({ ...brief, would_send: true }); continue; }
    const payload = { to: toAddr, from: m.from, subject: m.subject, text: m.body, message_id: 'gmail-' + m.id };
    try {
      const r = await intake.handler({ httpMethod: 'POST', queryStringParameters: { secret: emailSecret }, body: JSON.stringify(payload) });
      const d = JSON.parse((r && r.body) || '{}');
      const st = d.duplicate_email ? 'deduped' : (d.status || (d.ok ? 'ok' : 'error'));
      if (st === 'created') out.created++; else if (st === 'deduped' || d.duplicate_email) out.deduped++; else out.skipped++;
      // A dedup that filled blanks is the WHOLE point of a backfill - count it, or the run
      // reads as "0 created" and looks like it did nothing.
      for (const j of d.jobs || []) {
        const n = (j.filled || []).length;
        if (n) { out.enriched++; out.fields_filled += n; }
      }
      out.results.push({ ...brief, status: st, jobs: (d.jobs || []).map((j) => ({ claim: j.claim, customer: j.customer, appliance: j.appliance, matched_on: j.matched_on || undefined, filled: (j.filled || []).length ? j.filled : undefined })) });
    } catch (e) { out.skipped++; out.results.push({ ...brief, error: String((e && e.message) || e).slice(0, 120) }); }
  }
  return out;
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'admin secret required (?secret=)' });
  const res = await runTee(q.dryrun === '1', { days: q.days, subject: q.subject, max: q.max, q: q.q, budgetMs: q.budget_ms });
  return json(200, res);
};

exports.runTee = runTee;
