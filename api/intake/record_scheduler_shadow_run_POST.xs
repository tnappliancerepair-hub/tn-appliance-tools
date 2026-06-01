// Audits each shadow-mode run of the auto-scheduler. Called by the
// scheduler-shadow cron every 15 min. Writes one event_log row per run
// so the efficiency report page can read history. Shadow mode = no
// mutations to jobs.technician_id / scheduled_start, no SMS fired.
query record_scheduler_shadow_run verb=POST {
  api_group = "intake"

  input {
    text run_id
    text? target_date?
    int? total_jobs_in?
    int? flexible_in?
    int? anchors_in?
    int? techs_active?
    int? unrouted_count?
    int? plan_size?
    text? tech_rollup?
  }

  stack {
    db.add event_log {
      data = {
        action  : "scheduler_shadow_run"
        metadata: {
          run_id         : ($input.run_id ?? "")
          target_date    : (($input.target_date ?? "")|trim)
          total_jobs_in  : ($input.total_jobs_in ?? 0)
          flexible_in    : ($input.flexible_in ?? 0)
          anchors_in     : ($input.anchors_in ?? 0)
          techs_active   : ($input.techs_active ?? 0)
          unrouted_count : ($input.unrouted_count ?? 0)
          plan_size      : ($input.plan_size ?? 0)
          tech_rollup    : (($input.tech_rollup ?? "")|trim)
          fired_at_ms    : (now|to_ms)
        }
      }
    } as $audit
  }

  response = {
    success: true
    id     : $audit.id
  }

  guid = "record-scheduler-shadow-run-v1"
}
