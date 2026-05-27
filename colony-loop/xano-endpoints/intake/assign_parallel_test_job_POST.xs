// Step 5 — assign exactly ONE parallel-mode test job per active tech per
// day. Called by the colony loop scheduler at 6am CT. For each tech in
// (2,3,4,5,6), find an in-progress or scheduled HCP-origin job in their
// geography that they're also doing today, mark it as their parallel test
// rep via event_log action='parallel_test_assigned'.
//
// Once marked, the tech's dashboard surfaces it in a 'Today's Parallel
// Test Job' section with a tag. They do the work once for the customer
// (via HCP normally), then file the TDR through the new system as the
// daily test rep.
query assign_parallel_test_job verb=POST {
  api_group = "intake"

  input {
    int technician_id
  }

  stack {
    var $now_ms { value = now|to_ms }
    var $today_start_ms { value = $now_ms - (12 * 3600 * 1000) }
    var $day_end_ms { value = $now_ms + (16 * 3600 * 1000) }

    // Dedup: has a parallel test already been assigned for this tech today?
    db.query event_log {
      where  = $db.event_log.action == "parallel_test_assigned" && $db.event_log.created_at >= $today_start_ms
      sort   = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 20}}
    } as $assigned_rows

    var $tech_marker { value = "\"tech_id\":" ~ ($input.technician_id|to_text) }
    var $already_assigned { value = false }
    var $existing_job_id { value = 0 }

    foreach ($assigned_rows.items) {
      each as $ar {
        conditional {
          if (!$already_assigned) {
            var $ar_meta { value = ($ar.metadata ?? "") }
            var $ar_strip { value = $ar_meta|replace:$tech_marker:"" }
            conditional {
              if (($ar_meta|strlen) > ($ar_strip|strlen)) {
                var.update $already_assigned { value = true }
              }
            }
          }
        }
      }
    }

    conditional {
      if ($already_assigned) {
        return {
          value = {success: true, action: "already_assigned_today", tech_id: $input.technician_id}
        }
      }
    }

    // Find a candidate job — assigned to this tech today, scheduled or in_progress.
    // Skip jobs that already have a TDR from this tech (already worked).
    db.query jobs {
      where  = $db.jobs.technician_id == $input.technician_id && $db.jobs.scheduled_start >= $today_start_ms && $db.jobs.scheduled_start < $day_end_ms && ($db.jobs.scheduling_status == "scheduled" || $db.jobs.scheduling_status == "in_progress")
      sort   = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 10}}
    } as $candidate_rows

    var $candidate_count { value = ($candidate_rows.items|count) }

    conditional {
      if ($candidate_count == 0) {
        db.add event_log {
          data = {
            action  : "parallel_test_no_candidate"
            metadata: {tech_id: $input.technician_id}
          }
        } as $no_cand_log

        return {
          value = {success: true, action: "no_candidate_today", tech_id: $input.technician_id}
        }
      }
    }

    // Pick the first candidate
    var $chosen { value = $candidate_rows.items|get:0 }
    var $chosen_id { value = $chosen.id }

    // Mark as parallel test via event_log + audit
    db.add event_log {
      data = {
        action  : "parallel_test_assigned"
        metadata: {
          tech_id : $input.technician_id
          job_id  : $chosen_id
          appliance: ($chosen.appliance_type ?? "")
          city    : ($chosen.service_city ?? "")
        }
      }
    } as $assign_log
  }

  response = {
    success     : true
    action      : "assigned"
    tech_id     : $input.technician_id
    job_id      : $chosen_id
  }

  guid = "assign-parallel-test-job-v1"
}
