// CSC tool — once the agent has a job_id (from lookup_by_claim_number),
// this returns a compact status snapshot suitable for an audible answer:
// "Yes, this is scheduled for tomorrow at 10am with Jimmy, in progress
// as of yesterday, awaiting parts, TDR completed showing failed inverter."
//
// Designed for fast spoken summary — not for human dashboards.
query get_job_status_for_warranty verb=POST {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id is required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    var $tech_name {
      value = ""
    }
    var $tech_id {
      value = ($job.technician_id ?? 0)
    }
    conditional {
      if ($tech_id > 0) {
        db.get technicians {
          field_name = "id"
          field_value = $tech_id
        } as $tech
        var.update $tech_name {
          value = (($tech.first_name ?? "") ~ " " ~ ($tech.last_name ?? ""))|trim
        }
      }
    }

    // Latest TDR (any author) — gives diagnosis if completed
    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id
      sort = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $tdr_rows

    var $latest_tdr {
      value = (($tdr_rows.items|first) ?? null)
    }

    // Latest scheduled_start change in event_log — for "last_change_at"
    var $marker {
      value = "\"job_id\":" ~ ($input.job_id|to_text)
    }

    db.query event_log {
      where = $db.event_log.action == "job_state_transition" || $db.event_log.action == "appointment_scheduled_signal_emitted" || $db.event_log.action == "appointment_confirmation_sent" || $db.event_log.action == "job_completed_signal_emitted" || $db.event_log.action == "warranty_status_recorded"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $event_rows

    var $last_change_at {
      value = 0
    }
    var $last_change_action {
      value = ""
    }

    foreach ($event_rows.items) {
      each as $r {
        var $meta_str {
          value = ($r.metadata ?? {})|json_encode
        }
        var $stripped {
          value = $meta_str|replace:$marker:""
        }
        conditional {
          if (($stripped|strlen) < ($meta_str|strlen) && $last_change_at == 0) {
            var.update $last_change_at {
              value = ($r.created_at ?? 0)
            }
            var.update $last_change_action {
              value = ($r.action ?? "")
            }
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "csc_tool_get_job_status"
        metadata: ({job_id: $input.job_id}|json_encode)
      }
    }
  }

  response = {
    success           : true
    job_id            : $input.job_id
    scheduling_status : ($job.scheduling_status ?? "")
    current_status    : ($job.current_status ?? "")
    friendly_status   : ($job.friendly_status ?? "")
    scheduled_start_ms: ($job.scheduled_start ?? 0)
    tech_id           : $tech_id
    tech_name         : $tech_name
    appliance_type    : ($job.appliance_type ?? "")
    brand             : ($job.brand ?? "")
    model_number      : ($job.model_number ?? "")
    serial_number     : ($job.serial_number ?? "")
    problem_summary   : ($job.problem_summary ?? "")
    parts_status      : ($job.parts_status ?? "")
    parts_eta_date    : ($job.parts_eta_date ?? "")
    warranty_company  : ($job.warranty_company ?? "")
    claim_number      : ($job.claim_number ?? "")
    last_change_action: $last_change_action
    last_change_at_ms : $last_change_at
    tdr               : {
      exists            : ($latest_tdr != null)
      diagnosis         : ($latest_tdr.diagnosis ?? "")
      failed_component  : ($latest_tdr.failed_component ?? "")
      repair_completed  : ($latest_tdr.repair_completed ?? "")
      labor_time_hours  : ($latest_tdr.labor_time_hours ?? 0)
      created_at_ms     : ($latest_tdr.created_at ?? 0)
    }
  }

  guid = "get-job-status-for-warranty-v1"
}
