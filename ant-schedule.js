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
      if (!res.ok || !data.success) return { ok: false, error: (data && (data.error || data.message)) || ('failed (' + res.status + ')'), recovered: recovered };
      // Fire the "you're scheduled for {day/date}" + intake-if-needed packet to the
      // customer (Teddy 2026-07-20). Fire-and-forget + keepalive so it finishes even
      // if the tab navigates away; forward-only (only a real schedule triggers it);
      // schedule-packet itself dedups per day + suppresses the link if intake's done.
      try { fetch('/.netlify/functions/schedule-packet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), keepalive: true }); } catch (_) {}
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
      if (!res.ok || !data.success) return { ok: false, error: (data && (data.error || data.message)) || ('failed (' + res.status + ')') };
      return { ok: true };
    } catch (e) { return { ok: false, error: (e && e.message) || 'network error' }; }
  }

  global.AntSchedule = { schedule: schedule, reassign: reassign, isLocked: isLocked };
})(window);
