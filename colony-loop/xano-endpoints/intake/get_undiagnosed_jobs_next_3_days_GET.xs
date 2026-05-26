// Returns jobs scheduled in the next N days that have NO pre-diagnosis
// TDR from Teddy (technician_id=1). Used by the daily_job_prep agent to
// generate the consolidated "needs pre-diagnosis" SMS to Teddy + each tech.
//
// Filters:
//   - scheduled_start between now and now + days_ahead * 24h
//   - scheduling_status NOT in {completed, canceled, no_fix_possible}
//   - no technician_decision_report row exists with this job_id AND
//     technician_id == 1
//
// Returns a flat list of {job_id, scheduled_start, technician_id, customer,
// appliance_type, brand, problem_summary} so the agent can group client-side.
query get_undiagnosed_jobs_next_3_days verb=GET {
  api_group = "intake"

  input {
    int? days_ahead?
  }

  stack {
    var $window_days {
      value = ($input.days_ahead ?? 3)
    }

    var $now_ms   { value = (now|to_ms) }
    var $end_ms   { value = ($now_ms + ($window_days * 24 * 60 * 60 * 1000)) }

    db.query jobs {
      where  = $db.jobs.scheduled_start >= $now_ms && $db.jobs.scheduled_start <= $end_ms && $db.jobs.scheduling_status != "completed" && $db.jobs.scheduling_status != "canceled" && $db.jobs.scheduling_status != "no_fix_possible"
      sort   = {jobs.scheduled_start: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $job_rows

    var $undiagnosed { value = [] }

    foreach ($job_rows.items) {
      each as $j {
        // Check for any TDR from Teddy on this job.
        db.query technician_decision_report {
          where  = $db.technician_decision_report.job_id == $j.id && $db.technician_decision_report.technician_id == 1
          sort   = {technician_decision_report.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $teddy_tdr_rows

        var $teddy_tdr_first {
          value = (($teddy_tdr_rows.items|first) ?? null)
        }

        conditional {
          if ($teddy_tdr_first == null) {
            var $customer_obj { value = null }
            conditional {
              if ($j.customer_id != null && $j.customer_id > 0) {
                db.get customer {
                  field_name  = "id"
                  field_value = $j.customer_id
                } as $customer_obj_load
                var.update $customer_obj { value = $customer_obj_load }
              }
            }

            array.push $undiagnosed {
              value = {
                job_id          : $j.id
                scheduled_start : $j.scheduled_start
                technician_id   : ($j.technician_id ?? null)
                appliance_type  : ($j.appliance_type ?? "")
                brand           : ($j.brand ?? "")
                problem_summary : ($j.problem_summary ?? "")
                customer_first  : ($customer_obj.first_name ?? "")
                customer_last   : ($customer_obj.last_name ?? "")
                customer_phone  : ($customer_obj.phone ?? "")
                service_city    : ($j.service_city ?? "")
              }
            }
          }
        }
      }
    }
  }

  response = {
    success      : true
    days_ahead   : $window_days
    undiagnosed  : $undiagnosed
  }

  guid = "get-undiagnosed-jobs-next-3-days-v1"
}
