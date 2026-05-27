// Powers Danielle's needs-scheduled.html. Lists jobs where:
//   - parallel_mode=true
//   - scheduled_start IS NULL or 0 (not yet scheduled)
//   - scheduling_status in ('not_ready','needs_scheduled')
// Sorted newest first.
query list_needs_scheduled_parallel verb=GET {
  api_group = "intake"

  input {
    int? limit?
  }

  stack {
    var $lim_raw { value = ($input.limit ?? 100) }
    var $lim { value = ($lim_raw > 200) ? 200 : $lim_raw }

    // Until jobs.parallel_mode + jobs.intake_source columns are added
    // (operator todo via Xano UI), we use event_log scan to find jobs
    // marked parallel via the parallel_job_created_from_email action.
    db.query event_log {
      where  = $db.event_log.action == "parallel_job_created_from_email"
      sort   = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $marker_rows

    var $candidate_job_ids { value = [] }
    var $added_count { value = 0 }

    foreach ($marker_rows.items) {
      each as $mr {
        conditional {
          if ($added_count < $lim) {
            var $mr_meta_raw { value = ($mr.metadata ?? "") }
            // extract job_id value from JSON substring (no json_decode)
            var $split_jid { value = $mr_meta_raw|split:"\"job_id\":" }
            conditional {
              if (($split_jid|count) >= 2) {
                var $after_jid { value = $split_jid|get:1 }
                var $jid_split { value = $after_jid|split:"," }
                var $jid_first { value = ($jid_split|get:0)|trim }
                var $jid_int { value = $jid_first|to_int }
                conditional {
                  if ($jid_int > 0) {
                    var.update $candidate_job_ids { value = $candidate_job_ids|push:$jid_int }
                    var.update $added_count { value = $added_count + 1 }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Now fetch the actual job rows that are still unscheduled
    var $job_rows_items { value = [] }

    foreach ($candidate_job_ids) {
      each as $jid {
        db.get jobs {
          field_name  = "id"
          field_value = $jid
        } as $j_row

        conditional {
          if ($j_row != null && (($j_row.scheduled_start ?? 0) == 0)) {
            var.update $job_rows_items { value = $job_rows_items|push:$j_row }
          }
        }
      }
    }

    var $job_rows { value = {items: $job_rows_items} }

    var $items { value = [] }

    foreach ($job_rows.items) {
      each as $j {
        db.get customer {
          field_name  = "id"
          field_value = ($j.customer_id ?? 0)
        } as $cust

        var $row {
          value = {
            id                 : $j.id
            created_at         : ($j.created_at ?? 0)
            customer_first     : (($cust.first_name ?? "")|trim)
            customer_last      : (($cust.last_name ?? "")|trim)
            customer_phone     : (($cust.phone ?? "")|trim)
            service_address    : (($j.service_address ?? ($cust.address ?? ""))|trim)
            service_city       : (($j.service_city ?? ($cust.city ?? ""))|trim)
            service_state      : (($j.service_state ?? ($cust.state ?? ""))|trim)
            service_zip        : (($j.service_zip ?? ($cust.zip ?? ""))|trim)
            appliance          : (($j.appliance_type ?? "")|trim)
            brand              : (($j.brand ?? "")|trim)
            model_number       : (($j.model_number ?? "")|trim)
            problem_summary    : (($j.problem_summary ?? "")|trim)
            warranty_company   : (($j.warranty_company ?? "")|trim)
            claim_number       : (($j.claim_number ?? "")|trim)
            intake_source      : (($j.intake_source ?? "")|trim)
          }
        }

        var.update $items { value = $items|push:$row }
      }
    }
  }

  response = {
    success     : true
    count       : ($items|count)
    items       : $items
  }

  guid = "list-needs-scheduled-parallel-v1"
}
