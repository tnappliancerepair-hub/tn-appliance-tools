// ant-schedule.js — the ONE place the whole office schedules a job (Teddy 2026-07-17).
// Every office surface (New Schedule calendar, job board, needs-scheduled, do-next,
// ready) calls AntSchedule.schedule(...) instead of keeping its OWN copy of the
// fetch + terminal_locked recovery. Five drifted copies are exactly why New Schedule
// silently broke while the others worked. With one shared save, a fix — or a bug —
// can never live on just one screen again.
//
// The server (danielle_schedule_parallel_job) self-heals locked jobs as of 2026-07-17,
// so the client recovery in here is now belt-and-suspenders for anything it misses.
(function (global) {
  var XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
  function isLocked(err) { return /terminal|illegal|transition|locked/i.test(String(err || '')); }

  // The day the office THINKS it booked, as a Central YYYY-MM-DD. en-CA gives that shape
  // directly; building it from getMonth()/getDate() is the documented off-by-one that made
  // Ann quote the wrong day, so don't hand-roll it.
  function dayCT(ms) {
    if (!Number(ms)) return '';
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Number(ms))); } catch (_) { return ''; }
  }

  // THE RECEIPT — "who scheduled what, when, and did it stick" (Teddy 2026-09-16).
  // Until now only new-scheduling.html wrote one, so 6 of the 7 office surfaces saved
  // silently: when Danielle asked "I swore Andre had Friday stops," there was no record
  // to answer with -- 7 receipts existed across 3 days of real scheduling. Writing it
  // HERE means every surface that routes through AntSchedule is covered at once and a
  // new screen can never ship without it.
  //
  // Fire-and-forget + keepalive so it survives the tab navigating away, and wrapped so a
  // logging failure can NEVER fail a save that already landed. A receipt is a record of
  // the save, not part of it.
  function receipt(o) {
    o = o || {};
    try {
      fetch('/.netlify/functions/schedule-receipt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({
          job_id: Number(o.jobId || 0),
          actor: String(o.actor || 'office'),
          tech_id: Number(o.techId || 0),
          day: o.day || dayCT(o.startMs),
          confirmed: !!o.confirmed,
        }),
      });
    } catch (_) {}
  }
  function post(path, body) { return fetch(XANO + '/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  // Reopen a locked/terminal job to not_ready — the state machine ALWAYS permits
  // not_ready -> scheduled, so this recovers both a canceled job AND a started job
  // sent back for a parts return (in_progress, which can't go straight to scheduled).
  async function reopen(jobId, actor) { try { await post('office_set_job_status', { job_id: jobId, scheduling_status: 'not_ready', actor: actor || 'office' }); } catch (_) {} }

  // Schedule a job to a tech + day.  opts: { jobId, techId, startMs, actor }
  // returns { ok, error, recovered }.
  async function schedule(opts) {
    opts = opts || {};
    var jobId = Number(opts.jobId || 0), techId = Number(opts.techId || 0), startMs = Number(opts.startMs || 0), actor = opts.actor || 'office';
    if (!jobId || !techId || !startMs) return { ok: false, error: 'missing job/tech/day' };
    var body = { job_id: jobId, technician_id: techId, scheduled_start_ms: startMs, service_eta_window: opts.etaWindow || '' };
    if (Number(opts.endMs) > 0) body.scheduled_end_ms = Number(opts.endMs);
    var recovered = false;
    try {
      var res = await post('danielle_schedule_parallel_job', body);
      var data = await res.json().catch(function () { return {}; });
      if ((!res.ok || !data.success) && isLocked(data && (data.error || data.current_state))) {
        await reopen(jobId, actor);
        res = await post('danielle_schedule_parallel_job', body);
        data = await res.json().catch(function () { return {}; });
        recovered = true;
      }
      // A FAILED save is the single most valuable receipt to have. "It told me it saved and
      // it wasn't there" is exactly the complaint this exists to settle, so log the miss too.
      // NOTE the asymmetry, and it is deliberate: receipt:false only suppresses the SUCCESS
      // write (for a caller doing its own stronger verify). A MISS is always recorded, because
      // no surface logs one today -- and "it said saved and it wasn't there" is the exact
      // complaint this whole mechanism exists to settle.
      if (!res.ok || !data.success) {
        receipt({ jobId: jobId, techId: techId, startMs: startMs, actor: actor, confirmed: false });
        return { ok: false, error: (data && (data.error || data.message)) || ('failed (' + res.status + ')'), recovered: recovered };
      }
      // Fire the "you're scheduled for {day/date}" + intake-if-needed packet to the
      // customer (Teddy 2026-07-20). Fire-and-forget + keepalive so it finishes even
      // if the tab navigates away; forward-only (only a real schedule triggers it);
      // schedule-packet itself dedups per day + suppresses the link if intake's done.
      try { fetch('/.netlify/functions/schedule-packet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), keepalive: true }); } catch (_) {}
      // 🔁 Tell the warranty portal a RETURN appointment was set (Frontdoor/AHS status
      // 400). Every office surface books through here, so wiring it once covers all of
      // them -- and a new screen can't ship without it.
      //
      // We fire on EVERY schedule and let the server decide: a browser can't tell a
      // return trip from a first booking, but the job row can (frontdoor-push-job checks
      // job_started_at / parts_status and skips 'not_a_return'). So this reports the
      // EVENT and the server decides whether the STATUS is true. It also no-ops for any
      // job that isn't an AHS dispatch, and stays SHADOW until FRONTDOOR_PUSH_LIVE=1.
      //
      // Fire-and-forget + keepalive, same as the packet above: a partner push is a record
      // of the save, never part of it, and can NEVER fail a booking that already landed.
      try { fetch('/.netlify/functions/frontdoor-push-job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ job_id: jobId, status_key: 'RETURN_SET', technician_id: techId, note: 'Return appointment set for ' + (dayCT(startMs) || 'the scheduled day') + '.' }) }); } catch (_) {}
      // confirmed:true is honest here -- danielle_schedule_parallel_job re-reads the job and
      // returns failure if it is still not scheduled ($final_ok, 2026-08-04), so data.success
      // IS a server-verified save. A caller doing its own stronger read-back verify (see
      // new-scheduling.html) passes receipt:false and writes its own instead of double-logging.
      if (opts.receipt !== false) receipt({ jobId: jobId, techId: techId, startMs: startMs, actor: actor, confirmed: true });
      return { ok: true, recovered: recovered };
    } catch (e) { return { ok: false, error: (e && e.message) || 'network error' }; }
  }

  // Reassign only (same day, different tech).  opts: { jobId, techId, actor }
  async function reassign(opts) {
    opts = opts || {};
    var jobId = Number(opts.jobId || 0), techId = Number(opts.techId || 0), actor = opts.actor || 'office';
    if (!jobId || !techId) return { ok: false, error: 'missing job/tech' };
    var body = { job_id: jobId, technician_id: techId };
    try {
      var res = await post('reassign_job', body);
      var data = await res.json().catch(function () { return {}; });
      if ((!res.ok || !data.success) && isLocked(data && (data.error || data.current_state))) {
        await reopen(jobId, actor);
        res = await post('reassign_job', body);
        data = await res.json().catch(function () { return {}; });
      }
      if (!res.ok || !data.success) {
        receipt({ jobId: jobId, techId: techId, actor: actor, day: '', confirmed: false });
        return { ok: false, error: (data && (data.error || data.message)) || ('failed (' + res.status + ')') };
      }
      // Day intentionally blank: a reassign changes WHO, not WHEN.
      if (opts.receipt !== false) receipt({ jobId: jobId, techId: techId, actor: actor, day: '', confirmed: true });
      return { ok: true };
    } catch (e) { return { ok: false, error: (e && e.message) || 'network error' }; }
  }

  global.AntSchedule = { schedule: schedule, reassign: reassign, isLocked: isLocked, receipt: receipt, dayCT: dayCT };
})(window);
