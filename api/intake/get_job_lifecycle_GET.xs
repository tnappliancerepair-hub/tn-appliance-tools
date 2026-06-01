// Returns the full lifecycle history of a job — every state transition,
// every audit event, every signal emission — for the timeline view on
// job-detail.html. Reads event_log for action=job_state_transition rows
// matching the given job_id.
query get_job_lifecycle verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    var $marker { value = "\"job_id\":" ~ ($input.job_id|to_text) }

    // Pull recent event_log rows; client-side filter by metadata.
    db.query event_log {
      where = $db.event_log.action == "job_state_transition" || $db.event_log.action == "job_state_transition_rejected" || $db.event_log.action == "lifecycle_smoke_job_seeded" || $db.event_log.action == "office_ant_job_created" || $db.event_log.action == "parallel_job_created_from_email" || $db.event_log.action == "appointment_confirmation_sent"
      sort = {event_log.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $event_rows

    var $timeline { value = [] }

    foreach ($event_rows.items) {
      each as $r {
        var $meta_obj { value = ($r.metadata ?? {}) }
        var $meta_str { value = $meta_obj|json_encode }
        var $stripped { value = $meta_str|replace:$marker:"" }
        var $combined_len { value = $meta_str|strlen }
        var $stripped_len { value = $stripped|strlen }

        conditional {
          if ($stripped_len < $combined_len) {
            var $entry {
              value = {
                id        : $r.id
                action    : $r.action
                created_at: $r.created_at
                metadata  : $r.metadata
              }
            }
            var.update $timeline {
              value = $timeline|push:$entry
            }
          }
        }
      }
    }

    // Also load current job state for the header
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  }

  response = {
    success : true
    job_id  : $input.job_id
    current : {
      scheduling_status: ($job.scheduling_status ?? "")
      technician_id    : ($job.technician_id ?? 0)
      scheduled_start  : ($job.scheduled_start ?? 0)
      customer_id      : ($job.customer_id ?? 0)
    }
    timeline: $timeline
    count   : ($timeline|count)
  }

  guid = "get-job-lifecycle-v1"
}
