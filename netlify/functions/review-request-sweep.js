// review-request-sweep — after a job completes, texts the customer "How'd we do? 👍/👎"
// and arms the satisfaction gate. Their reply routes itself (customer-sms-inbound ->
// _lib/satisfaction): 👍 -> Google review link, 👎 -> "what could we have done better?"
// (private capture + Teddy alert, so an unhappy customer is handled by a human instead
// of leaving a public 1-star). Reviews lift Local Services Ads rank + the map pack.
//
// Forward-only (only completions in the lookback window — historical never fires) + 60-day
// per-customer dedup, sharing the SAME dedup key as the colony agent so we never double-text.
//
//   scheduled (daily)   ask recently-completed customers
//   GET ?dryrun=1       show who WOULD be asked, send nothing
//   GET ?hours=N        lookback window (default 26h)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const reviewAsk = require('./_lib/review-ask');

const MAX_PER_RUN = 25;

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const dry = q.dryrun === '1';
  const hours = Math.min(parseInt(q.hours || '26', 10) || 26, 168);
  const since = Date.now() - hours * 3600000;

  // 1) recent completions. ROOT-CAUSE FIX (2026-08-06): the sweep only watched
  // tech_job_complete, which fires ~0 times (techs finish jobs elsewhere) — so it was
  // starved and asked 0 customers for months. The signal that ACTUALLY flows when a job
  // reaches its end is office_invoice_logged (~14/day). Feed from BOTH, dedup by job.
  // SAFETY: the per-job LIVE status recheck below (must be scheduling/current ===
  // 'completed') still gates every send, so an invoice logged on an awaiting-parts job
  // (first-trip labor billed, parts trip pending) is correctly skipped — only truly-done
  // jobs get "how'd we do?". Same starvation + backup-trigger pattern as the SP claims fix.
  const jobIds = [];
  const seen = new Set();
  const srcOf = {};
  // a) explicit completion events (kept — usually empty today, harmless)
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'tech_job_complete' }, { id: 'desc' }, 120);
    for (const r of rows || []) {
      if (Number(r.created_at || 0) < since) continue;        // forward-only
      const m = meta(r);
      if (String(m.new_scheduling_status || '') !== 'completed') continue;
      const jid = Number(m.job_id || 0);
      if (jid && !seen.has(jid)) { seen.add(jid); jobIds.push(jid); srcOf[jid] = 'complete'; }
    }
  } catch (_) {}
  // b) canonical job_completed — the completion backbone (job-completion-watch emits it
  // off the office_set_job_status→completed transition, the signal that actually flows).
  // This is the primary source now; it catches jobs whether or not they were invoiced.
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'job_completed' }, { id: 'desc' }, 300);
    for (const r of rows || []) {
      if (Number(r.created_at || 0) < since) continue;        // forward-only
      const jid = Number(meta(r).job_id || 0);
      if (jid && !seen.has(jid)) { seen.add(jid); jobIds.push(jid); srcOf[jid] = 'completed'; }
    }
  } catch (_) {}
  // c) invoiced jobs — a second end-of-job signal (some finish via billing). liveDone recheck filters.
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'office_invoice_logged' }, { id: 'desc' }, 300);
    for (const r of rows || []) {
      if (Number(r.created_at || 0) < since) continue;        // forward-only
      const jid = Number(meta(r).job_id || 0);
      if (jid && !seen.has(jid)) { seen.add(jid); jobIds.push(jid); srcOf[jid] = 'invoice'; }
    }
  } catch (_) {}

  // 2) send the gated "How'd we do? 👍/👎" ask per job (backstop for the instant path
  // in job-completion-watch). ALL send logic + gates + the gated-ask message live in the
  // shared _lib/review-ask.sendAskForJob, so this nightly sweep and the instant trigger
  // always behave identically. dry=1 evaluates the gates without sending.
  const sent = [], skipped = [];
  for (const jid of jobIds.slice(0, MAX_PER_RUN)) {
    const r = await reviewAsk.sendAskForJob(jid, { via: 'sweep', source: srcOf[jid] || 'complete', dry });
    if (r.sent || r.would_send) sent.push({ job_id: jid, customer: r.cust_id, first: r.first, lang: r.lang });
    else skipped.push({ job_id: jid, customer: r.cust_id, why: r.reason });
  }

  const bySrc = jobIds.reduce((a, jid) => { const s = srcOf[jid] || 'complete'; a[s] = (a[s] || 0) + 1; return a; }, {});
  return j(200, { ok: true, mode: dry ? 'dryrun' : 'live', lookback_hours: hours, completions_found: jobIds.length, sources: bySrc, asked: sent.length, skipped: skipped.length, sent, skipped: skipped.slice(0, 10) });
};
