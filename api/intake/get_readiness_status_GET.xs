// Tomorrow-morning readiness check. Returns a single bundle of pass/fail
// indicators across the system's critical paths so Teddy can verify
// everything's healthy in 10 seconds before flipping the customer SMS gate.
//
// Each check returns: { ok: bool, detail: text, ts_ms: int }
query get_readiness_status verb=GET {
  api_group = "intake"

  stack {
    var $now_ms { value = (now|to_ms) }
    var $hour_ago { value = ($now_ms - 3600000) }
    var $hour_ago_ts { value = ($hour_ago / 1000)|to_timestamp }
    var $day_ago { value = ($now_ms - 86400000) }
    var $day_ago_ts { value = ($day_ago / 1000)|to_timestamp }

    // ── Check 1: Backup ran in last 24h ──
    db.query event_log {
      where = $db.event_log.created_at >= $day_ago_ts && $db.event_log.action == "xano_backup_completed"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $backup_rows
    var $backup_ok { value = (($backup_rows.items|count) > 0) }
    var $backup_last { value = ($backup_ok == true) ? ($backup_rows.items|first).created_at : 0 }

    // ── Check 2: Colony loop heartbeat (last 10 min) ──
    var $heartbeat_cutoff { value = ($now_ms - 600000) }
    var $heartbeat_cutoff_ts { value = ($heartbeat_cutoff / 1000)|to_timestamp }
    db.query event_log {
      where = $db.event_log.created_at >= $heartbeat_cutoff_ts && $db.event_log.action == "loop_heartbeat"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $hb_rows
    var $hb_ok { value = (($hb_rows.items|count) > 0) }
    var $hb_last { value = ($hb_ok == true) ? ($hb_rows.items|first).created_at : 0 }

    // ── Check 3: Email pollers ran in last 30 min ──
    var $poller_cutoff { value = ($now_ms - 1800000) }
    var $poller_cutoff_ts { value = ($poller_cutoff / 1000)|to_timestamp }
    db.query event_log {
      where = $db.event_log.created_at >= $poller_cutoff_ts && ($db.event_log.action == "ahs_email_poller_run" || $db.event_log.action == "servicepower_email_poller_run" || $db.event_log.action == "ahs_email_intake_received" || $db.event_log.action == "servicepower_email_intake_received")
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $poller_rows
    var $poller_ok { value = (($poller_rows.items|count) > 0) }
    var $poller_last { value = ($poller_ok == true) ? ($poller_rows.items|first).created_at : 0 }

    // ── Check 4: Errors in last hour ──
    db.query event_log {
      where = $db.event_log.created_at >= $hour_ago_ts && ($db.event_log.action == "loop_error" || $db.event_log.action == "sms_provider_error" || $db.event_log.action == "intake_error")
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $error_rows
    var $error_count { value = ($error_rows.items|count) }
    var $errors_ok { value = ($error_count == 0) }

    // ── Check 5: SMS gate state ──
    db.query company_settings {
      where = $db.company_settings.company_id == 1 && $db.company_settings.setting_key == "customer_facing_enabled"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $gate_rows
    var $gate_setting { value = (($gate_rows.items|first) ?? null) }
    var $gate_val { value = ($gate_setting != null) ? (($gate_setting.setting_value ?? "")|trim|to_lower) : "" }
    var $env_gate { value = (($env.CUSTOMER_FACING_ENABLED ?? "false") == "true") }
    var $gate_on { value = ($gate_val != "") ? ($gate_val == "true") : $env_gate }

    // ── Check 6: State machine endpoint exists (smoke via known job_id) ──
    // We can't actually call it from within XS easily, so the indirect
    // check: state machine writes events with action 'job_state_transition'.
    // If any happened in the last 24h, the endpoint is reachable.
    db.query event_log {
      where = $db.event_log.created_at >= $day_ago_ts && $db.event_log.action == "job_state_transition"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $sm_rows
    var $sm_ok { value = (($sm_rows.items|count) > 0) }

    // ── Check 7: Scheduler ran in last 24h ──
    db.query event_log {
      where = $db.event_log.created_at >= $day_ago_ts && $db.event_log.action == "scheduler_shadow_run"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $sched_rows
    var $sched_ok { value = (($sched_rows.items|count) > 0) }
    var $sched_last { value = ($sched_ok == true) ? ($sched_rows.items|first).created_at : 0 }

    // ── Overall readiness ──
    var $blockers { value = 0 }
    conditional { if ($hb_ok == false) { var.update $blockers { value = ($blockers + 1) } } }
    conditional { if ($errors_ok == false) { var.update $blockers { value = ($blockers + 1) } } }
    conditional { if ($sm_ok == false) { var.update $blockers { value = ($blockers + 1) } } }

    var $overall_ready { value = ($blockers == 0) }
  }

  response = {
    success     : true
    as_of_ms    : $now_ms
    overall_ready: $overall_ready
    blockers    : $blockers
    checks      : {
      backup          : { ok: $backup_ok,  last_ts_ms: $backup_last,  detail: "nightly Xano backup" }
      heartbeat       : { ok: $hb_ok,       last_ts_ms: $hb_last,      detail: "colony loop heartbeat (last 10 min)" }
      pollers         : { ok: $poller_ok,   last_ts_ms: $poller_last,  detail: "AHS / ServicePower email polls (last 30 min)" }
      errors_quiet    : { ok: $errors_ok,   error_count: $error_count, detail: "no loop_error / sms_provider_error in last hour" }
      gate            : { ok: true,         gate_on: $gate_on,         detail: "customer SMS gate state" }
      state_machine   : { ok: $sm_ok,                                  detail: "state transitions in last 24h (proves endpoint reachable)" }
      scheduler       : { ok: $sched_ok,    last_ts_ms: $sched_last,   detail: "scheduler cron ran in last 24h" }
    }
  }

  guid = "get-readiness-status-v1"
}
