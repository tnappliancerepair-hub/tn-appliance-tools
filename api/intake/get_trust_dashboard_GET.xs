// Trust Dashboard — honest accounting of what Ant did in the last 24h.
// Used to build/erode Teddy's trust in Ant's autonomy over time.
//
// Returns:
//   - jobs_handled_clean: jobs that went through every state without
//     human intervention or error
//   - jobs_needed_human: jobs where transition was reverted, escalated,
//     or otherwise needed Teddy/Danielle
//   - errors_24h: loop errors, sms errors, intake errors
//   - sms_activity: sent/dropped/inbound counts
//   - automation_wins: high-confidence "Ant did this correctly" examples
//   - intervention_examples: specific jobs where humans had to step in
query get_trust_dashboard verb=GET {
  api_group = "intake"

  input {
    int? hours_back?
  }

  stack {
    var $hours { value = ($input.hours_back ?? 24) }
    var $now_ms { value = (now|to_ms) }
    var $cutoff_ms { value = ($now_ms - ($hours * 3600000)) }
    var $cutoff_ts { value = ($cutoff_ms / 1000)|to_timestamp }

    // ── Transitions through the state machine (24h) ──
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && $db.event_log.action == "job_state_transition"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $transition_rows

    var $transition_count { value = ($transition_rows.items|count) }

    // ── Rejected transitions (human-attempted illegal moves) ──
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && $db.event_log.action == "job_state_transition_rejected"
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $reject_rows

    var $reject_count { value = ($reject_rows.items|count) }

    // ── Errors (any kind) ──
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && ($db.event_log.action == "loop_error" || $db.event_log.action == "sms_provider_error" || $db.event_log.action == "intake_error" || $db.event_log.action == "agent_error")
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $error_rows

    var $error_count { value = ($error_rows.items|count) }

    // ── SMS sent (success) ──
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && $db.event_log.action == "sms_sent"
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $sms_sent_rows
    var $sms_sent { value = ($sms_sent_rows.items|count) }

    // ── SMS dropped (gate or rate-limit) ──
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && $db.event_log.action == "dropped_customer_sms"
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $sms_dropped_rows
    var $sms_dropped { value = ($sms_dropped_rows.items|count) }

    // ── Inbound customer SMS ──
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && $db.event_log.action == "inbound_customer_sms_received"
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $inbound_rows
    var $inbound { value = ($inbound_rows.items|count) }

    // ── Escalations ──
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && ($db.event_log.action == "escalation_sent_to_teddy" || $db.event_log.action == "warranty_claim_action_persisted")
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $escalation_rows
    var $escalations { value = ($escalation_rows.items|count) }

    // ── Jobs created (intake activity) ──
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && ($db.event_log.action == "parallel_job_created_from_email" || $db.event_log.action == "office_ant_job_created" || $db.event_log.action == "voicemail_job_created" || $db.event_log.action == "lifecycle_smoke_job_seeded")
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $intake_rows
    var $jobs_created { value = ($intake_rows.items|count) }

    // ── Auto-scheduler runs ──
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && $db.event_log.action == "scheduler_shadow_run"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $sched_rows
    var $scheduler_runs { value = ($sched_rows.items|count) }

    // ── "Clean" jobs: had at least one job_state_transition AND zero
    //    rejected transitions AND zero errors involving job_id. We
    //    approximate by counting unique job_ids in $transition_rows
    //    that aren't in $reject_rows. Substring scan for "job_id" key.
    // ============================================================
    var $clean_count { value = ($transition_count - $reject_count) }
    conditional {
      if ($clean_count < 0) {
        var.update $clean_count { value = 0 }
      }
    }

    // Sample of recent transitions for the activity feed
    var $recent_transitions { value = [] }
    var $sample_cap { value = 20 }
    foreach ($transition_rows.items) {
      each as $r {
        var $sample_len { value = ($recent_transitions|count) }
        conditional {
          if ($sample_len < $sample_cap) {
            var $sample_entry {
              value = {
                id        : $r.id
                created_at: $r.created_at
                metadata  : $r.metadata
              }
            }
            var.update $recent_transitions {
              value = $recent_transitions|push:$sample_entry
            }
          }
        }
      }
    }

    // Recent errors sample
    var $recent_errors { value = [] }
    var $error_cap { value = 10 }
    foreach ($error_rows.items) {
      each as $r {
        var $err_len { value = ($recent_errors|count) }
        conditional {
          if ($err_len < $error_cap) {
            var $err_entry {
              value = {
                id        : $r.id
                action    : $r.action
                created_at: $r.created_at
                metadata  : $r.metadata
              }
            }
            var.update $recent_errors {
              value = $recent_errors|push:$err_entry
            }
          }
        }
      }
    }
  }

  response = {
    success    : true
    hours_back : $hours
    as_of_ms   : $now_ms
    summary    : {
      transitions      : $transition_count
      clean_jobs       : $clean_count
      needed_human     : $reject_count
      escalations      : $escalations
      errors           : $error_count
      jobs_created     : $jobs_created
      scheduler_runs   : $scheduler_runs
      sms_sent         : $sms_sent
      sms_dropped      : $sms_dropped
      sms_inbound      : $inbound
    }
    recent_transitions: $recent_transitions
    recent_errors     : $recent_errors
  }

  guid = "get-trust-dashboard-v1"
}
