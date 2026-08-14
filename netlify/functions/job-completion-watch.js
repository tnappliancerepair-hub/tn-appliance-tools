// job-completion-watch — the canonical "job is done" signal for the whole system.
//
// THE PROBLEM: tech_job_complete fires ~0 times (techs don't press Complete in Ant),
// so every pipeline keyed on it silently starved — reviews AND the ServicePower claims
// build both hit 0. The completion signal that ACTUALLY flows is the status transition
// office_set_job_status with to:'completed' — ~7 jobs/day, from BOTH the tech Complete
// path (actor:'tech') and office board moves (actor:'Danielle'/'Sofia').
//
// THE FIX: watch that transition and emit ONE canonical `job_completed` event per job —
// the reliable backbone other automations consume instead of the dead tech_job_complete
// (reviews now; SP claims / follow-ups / metrics next). Emits an INTERNAL event only —
// no SMS, no money here; downstream consumers (review-request-sweep) do the acting and
// keep their own gates (live-status recheck, phone, 60-day dedup).
//
// SAFE BY CONSTRUCTION: forward-only (only transitions inside the lookback window, so no
// historical backlog ever fires) + per-job dedup (a job emits job_completed once ever) +
// a per-run cap. Kill switch: JOB_COMPLETION_WATCH=false.
//   GET ?secret=<admin>[&dry=1]   manual   ·   scheduled runs self-authorize.
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const reviewAsk = require('./_lib/review-ask');

const LOOKBACK_H = 36;   // overlap so an occasional missed run still gets caught (dedup guards dupes)
const MAX_EMIT = 60;     // per-run backstop so a bulk status sweep can't flood downstream
const MAX_REVIEW_SEND = 15; // heavier work (get_job + SMS) — cap inline sends/run; rest caught next run + nightly sweep
exports.config = { timeout: 26 };
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (String(await getSecret('JOB_COMPLETION_WATCH') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  const dry = q.dry === '1';
  const since = Date.now() - (parseInt(q.hours, 10) || LOOKBACK_H) * 3600000;

  // 1) completion transitions in the window (the real signal, both tech + office paths)
  let statusRows = [];
  try { statusRows = await crud.searchPage(crud.TABLES.event_log, { action: 'office_set_job_status' }, { id: 'desc' }, 400); }
  catch (e) { return json(200, { ok: false, error: 'status scan failed: ' + String((e && e.message) || e) }); }

  // newest transition-to-completed per job inside the window
  const completedJobs = new Map(); // job_id -> { from, actor, at }
  for (const r of statusRows) {
    const at = Number(r.created_at || 0);
    if (at < since) continue;
    const m = meta(r);
    if (String(m.to || '').toLowerCase() !== 'completed') continue;
    const jid = Number(m.job_id || 0);
    if (!jid || completedJobs.has(jid)) continue;   // newest wins (rows are id desc)
    completedJobs.set(jid, { from: String(m.from || ''), actor: String(m.actor || ''), at });
  }

  // 2) which of those already have a canonical job_completed (emit once ever).
  // CAP AT 500: the Metadata content/search endpoint 400s on per_page > ~500, and
  // callXano THROWS on a 400 — which the catch here swallowed, leaving `already` empty
  // so EVERY windowed job re-emitted forever (526 job_completed rows for 23 jobs / 2d,
  // and — post-2026-08-14 — a wasted review lookup per re-emit). 500 keeps the read
  // valid; real completion volume (~7-14/day) means 500 rows covers ~35+ days. (2026-08-14)
  const already = new Set();
  try {
    const prior = await crud.searchPage(crud.TABLES.event_log, { action: 'job_completed' }, { id: 'desc' }, 500);
    for (const r of prior) { const jid = Number(meta(r).job_id || 0); if (jid) already.add(jid); }
  } catch (_) {}

  const fresh = [...completedJobs.entries()].filter(([jid]) => !already.has(jid));
  const toEmit = fresh.slice(0, MAX_EMIT);

  let emitted = 0, reviewSent = 0, reviewSkipped = 0;
  const reviewSample = [];
  if (!dry) {
    for (const [jid, info] of toEmit) {
      // canonical job_completed event (the backbone other automations consume)
      try {
        await crud.logEvent('job_completed', { job_id: jid, from: info.from, actor: info.actor, via: 'completion_watch', status_event_at: info.at, at_ms: Date.now() });
        emitted++;
      } catch (_) {}
      // INSTANT review ask — the moment a job is completed, text the customer
      // "How'd we do? 👍/👎" (👍 → thank-you + Google review link, via satisfaction).
      // The shared sender re-checks live-completed + 60-day dedup + phone, so this is
      // safe to fire per completion; the nightly sweep is the backstop for the rest.
      if (reviewSent < MAX_REVIEW_SEND) {
        try {
          const r = await reviewAsk.sendAskForJob(jid, { via: 'completion_instant', source: 'completion_watch' });
          if (r.sent) { reviewSent++; reviewSample.push({ job_id: jid, cust_id: r.cust_id }); }
          else { reviewSkipped++; if (reviewSample.length < 12) reviewSample.push({ job_id: jid, skipped: r.reason }); }
        } catch (_) { reviewSkipped++; }
      }
    }
  }

  const out = {
    ok: true, mode: dry ? 'dry' : 'live', lookback_hours: parseInt(q.hours, 10) || LOOKBACK_H,
    completed_transitions_in_window: completedJobs.size,
    already_emitted: completedJobs.size - fresh.length,
    fresh: fresh.length, emitted: dry ? 0 : emitted,
    review_asks_sent: dry ? 0 : reviewSent, review_asks_skipped: dry ? 0 : reviewSkipped,
    review_sample: dry ? [] : reviewSample,
    capped: fresh.length > MAX_EMIT ? (fresh.length - MAX_EMIT) : 0,
    sample: toEmit.slice(0, 12).map(([jid, i]) => ({ job_id: jid, from: i.from, actor: i.actor })),
  };
  if (dry) out.note = 'DRY — would emit job_completed for the fresh jobs above; nothing written.';
  try { await crud.logEvent('job_completion_watch_run', { mode: out.mode, fresh: fresh.length, emitted: out.emitted, review_asks_sent: out.review_asks_sent, in_window: completedJobs.size, at_ms: Date.now() }); } catch (_) {}
  return json(200, out);
};
