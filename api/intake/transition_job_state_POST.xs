// Canonical job state transition endpoint. ALL writes to
// jobs.scheduling_status should go through here.
//
// Spec: docs/job-state-machine.md
//
// Validation:
//   1. target_state must be a known state
//   2. (current_state, target_state) must be a legal transition
//   3. Pre-conditions met (e.g., 'completed' requires TDR exists)
//   4. terminal-state escapes require force_revert=true AND actor='admin'
//
// On success:
//   - jobs.scheduling_status updated to target_state
//   - optional payload fields applied (scheduled_start, technician_id)
//   - event_log row written: action='job_state_transition'
//   - colony_signal emitted based on target_state (where applicable)
//
// On failure:
//   - 400 with error code (illegal_transition / preconditions_failed /
//     terminal_locked / unknown_state)
//   - event_log row written: action='job_state_transition_rejected'
query transition_job_state verb=POST {
  api_group = "intake"

  input {
    int  job_id
    text target_state
    text actor
    text? reason?
    int?  technician_id?
    int?  scheduled_start_ms?
    bool? force_revert?
  }

  stack {
    // ============================================================
    // INPUT VALIDATION
    // ============================================================
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    var $target { value = (($input.target_state ?? "")|trim|to_lower) }
    var $actor  { value = (($input.actor ?? "")|trim|to_lower) }

    precondition ($target != "") {
      error_type = "inputerror"
      error = "target_state required"
    }

    precondition ($actor != "") {
      error_type = "inputerror"
      error = "actor required"
    }

    // Known states (matches docs/job-state-machine.md). The legacy enum
    // also includes 'pending', 'ready', 'booked', 'needs_pre_diagnosis' —
    // those are deprecated synonyms not accepted as target_state going
    // forward. 'intake_complete' is the "ready for scheduler" state.
    var $known_states {
      value = ["not_ready","needs_more_info","prediagnosis_pending","intake_complete","broadcasting","scheduled","awaiting_parts","held","in_progress","escalated","completed","no_fix_possible","canceled"]
    }

    var $target_is_known { value = false }

    foreach ($known_states) {
      each as $s {
        conditional {
          if ($s == $target) {
            var.update $target_is_known { value = true }
          }
        }
      }
    }

    precondition ($target_is_known == true) {
      error_type = "inputerror"
      error = "unknown target_state"
    }

    // Known actors
    var $known_actors {
      value = ["tech","office","customer","system","scheduler","vendor","admin"]
    }

    var $actor_is_known { value = false }

    foreach ($known_actors) {
      each as $a {
        conditional {
          if ($a == $actor) {
            var.update $actor_is_known { value = true }
          }
        }
      }
    }

    precondition ($actor_is_known == true) {
      error_type = "inputerror"
      error = "unknown actor"
    }

    // ============================================================
    // LOAD CURRENT JOB
    // ============================================================
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "job not found"
    }

    var $current { value = (($job.scheduling_status ?? "not_ready")|to_lower) }

    // ============================================================
    // TERMINAL-STATE GUARD
    // ============================================================
    var $terminal_states {
      value = ["completed","no_fix_possible","canceled"]
    }

    var $is_currently_terminal { value = false }

    foreach ($terminal_states) {
      each as $ts {
        conditional {
          if ($ts == $current) {
            var.update $is_currently_terminal { value = true }
          }
        }
      }
    }

    var $force_revert_flag {
      value = ($input.force_revert ?? false)
    }

    var $can_force_revert {
      value = ($force_revert_flag == true) && ($actor == "admin")
    }

    var $is_blocked_by_terminal {
      value = ($is_currently_terminal == true) && ($can_force_revert == false)
    }

    conditional {
      if ($is_blocked_by_terminal == true) {
        db.add event_log {
          data = {
            action  : "job_state_transition_rejected"
            metadata: {
              job_id        : $input.job_id
              from_state    : $current
              target_state  : $target
              actor         : $actor
              reason_text   : (($input.reason ?? "")|trim)
              error         : "terminal_locked"
            }
          }
        } as $reject_audit

        return {
          value = {success: false, error: "terminal_locked", current_state: $current}
        }
      }
    }

    // ============================================================
    // LEGAL TRANSITION CHECK
    // Build a per-source map of allowed target_states. If current →
    // target isn't in the list, reject.
    // ============================================================
    var $allowed_from_current {
      value = []
    }

    conditional {
      if ($current == "not_ready") {
        var.update $allowed_from_current { value = ["needs_more_info","intake_complete","prediagnosis_pending","canceled"] }
      }
    }
    conditional {
      if ($current == "needs_more_info") {
        var.update $allowed_from_current { value = ["intake_complete","canceled","not_ready"] }
      }
    }
    conditional {
      if ($current == "prediagnosis_pending") {
        var.update $allowed_from_current { value = ["intake_complete","canceled"] }
      }
    }
    conditional {
      if ($current == "intake_complete") {
        var.update $allowed_from_current { value = ["broadcasting","scheduled","held","canceled"] }
      }
    }
    conditional {
      if ($current == "broadcasting") {
        var.update $allowed_from_current { value = ["scheduled","intake_complete","canceled"] }
      }
    }
    conditional {
      if ($current == "scheduled") {
        var.update $allowed_from_current { value = ["in_progress","awaiting_parts","held","canceled","intake_complete"] }
      }
    }
    conditional {
      if ($current == "awaiting_parts") {
        var.update $allowed_from_current { value = ["scheduled","intake_complete","canceled"] }
      }
    }
    conditional {
      if ($current == "held") {
        var.update $allowed_from_current { value = ["scheduled","intake_complete","canceled"] }
      }
    }
    conditional {
      if ($current == "in_progress") {
        var.update $allowed_from_current { value = ["completed","awaiting_parts","no_fix_possible","escalated"] }
      }
    }
    conditional {
      if ($current == "escalated") {
        var.update $allowed_from_current { value = ["scheduled","canceled","completed"] }
      }
    }

    // Terminal → anything is force-revert only (admin path, handled above)
    conditional {
      if ($is_currently_terminal == true && $can_force_revert == true) {
        var.update $allowed_from_current { value = ["not_ready","intake_complete","scheduled"] }
      }
    }

    var $is_legal_target { value = false }

    foreach ($allowed_from_current) {
      each as $at {
        conditional {
          if ($at == $target) {
            var.update $is_legal_target { value = true }
          }
        }
      }
    }

    conditional {
      if ($is_legal_target == false) {
        db.add event_log {
          data = {
            action  : "job_state_transition_rejected"
            metadata: {
              job_id        : $input.job_id
              from_state    : $current
              target_state  : $target
              actor         : $actor
              reason_text   : (($input.reason ?? "")|trim)
              error         : "illegal_transition"
              allowed       : $allowed_from_current
            }
          }
        } as $reject_audit

        return {
          value = {success: false, error: "illegal_transition", current_state: $current, allowed: $allowed_from_current}
        }
      }
    }

    // ============================================================
    // PRE-CONDITIONS (state-specific)
    // ============================================================
    // 'completed' requires at least one TDR row to exist for this job.
    var $tdr_required {
      value = ($target == "completed")
    }

    conditional {
      if ($tdr_required == true) {
        db.query technician_decision_report {
          where = $db.technician_decision_report.job_id == $input.job_id
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $tdr_check

        var $has_tdr {
          value = (($tdr_check.items|count) > 0)
        }

        conditional {
          if ($has_tdr == false) {
            db.add event_log {
              data = {
                action  : "job_state_transition_rejected"
                metadata: {
                  job_id        : $input.job_id
                  from_state    : $current
                  target_state  : $target
                  actor         : $actor
                  error         : "preconditions_failed"
                  detail        : "completed requires at least one TDR"
                }
              }
            } as $reject_audit

            return {
              value = {success: false, error: "preconditions_failed", detail: "completed requires at least one TDR"}
            }
          }
        }
      }
    }

    // 'scheduled' requires a technician_id (either existing or in payload)
    conditional {
      if ($target == "scheduled") {
        var $existing_tech {
          value = ($job.technician_id ?? 0)
        }
        var $payload_tech {
          value = ($input.technician_id ?? 0)
        }
        var $tech_present {
          value = ($existing_tech > 0) || ($payload_tech > 0)
        }
        conditional {
          if ($tech_present == false) {
            return {
              value = {success: false, error: "preconditions_failed", detail: "scheduled requires technician_id"}
            }
          }
        }
      }
    }

    // ============================================================
    // APPLY THE TRANSITION
    // ============================================================
    // Resolve new field values — preserve existing when not in payload.
    var $tech_to_apply {
      value = ($input.technician_id ?? 0)
    }

    var $sched_to_apply {
      value = ($input.scheduled_start_ms ?? 0)
    }

    var $final_tech {
      value = ($tech_to_apply > 0) ? $tech_to_apply : ($job.technician_id ?? 0)
    }

    var $final_sched {
      value = ($sched_to_apply > 0) ? $sched_to_apply : ($job.scheduled_start ?? 0)
    }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        scheduling_status: $target
        technician_id    : $final_tech
        scheduled_start  : $final_sched
      }
    } as $updated

    // ============================================================
    // AUDIT
    // ============================================================
    db.add event_log {
      data = {
        action  : "job_state_transition"
        metadata: {
          job_id            : $input.job_id
          from_state        : $current
          to_state          : $target
          actor             : $actor
          reason_text       : (($input.reason ?? "")|trim)
          technician_id     : $tech_to_apply
          scheduled_start_ms: $sched_to_apply
          transitioned_at_ms: (now|to_ms)
        }
      }
    } as $audit
  }

  response = {
    success     : true
    job_id      : $input.job_id
    from_state  : $current
    to_state    : $target
    audit_id    : $audit.id
  }

  guid = "transition-job-state-v1"
}
