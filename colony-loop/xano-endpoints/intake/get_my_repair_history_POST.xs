// Customer-scoped repair history. Used by customer-ant-brain.
// Auth: takes job_id + phone_last4. Validates that this customer
// (the one tied to job_id) has matching phone_last4. If yes, returns
// their full job + TDR history. Defense-in-depth even though the
// portal page already validated — we never want a customer to peek
// at another customer's data via a tampered job_id.
mutation get_my_repair_history verb=POST {
  api_group = "intake"

  input {
    int  job_id
    text phone_last4
  }

  stack {
    var $jid { value = ($input.job_id ?? 0) }
    var $last4_in { value = (($input.phone_last4 ?? "")|trim) }

    precondition ($jid > 0 && $last4_in != "") {
      error_type = "inputerror"
      error      = "job_id and phone_last4 required"
    }

    db.get jobs {
      field_name  = "id"
      field_value = $jid
    } as $job

    var $cust_id { value = ($job.customer_id ?? 0) }
    precondition ($cust_id > 0) {
      error_type = "notfound"
      error      = "job not found"
    }

    db.get customer {
      field_name  = "id"
      field_value = $cust_id
    } as $cust

    // Phone last4 check (defense in depth — portal already validated)
    var $cust_phone_raw { value = (($cust.phone ?? "")|replace:"+":""|replace:"-":""|replace:"(":""|replace:")":""|replace:" ":"") }
    var $cust_phone_len { value = $cust_phone_raw|strlen }
    var $cust_last4_start { value = $cust_phone_len - 4 }
    var $cust_last4 { value = ($cust_phone_len >= 4) ? ($cust_phone_raw|substr:$cust_last4_start) : "" }

    precondition ($cust_last4 == $last4_in) {
      error_type = "unauth"
      error      = "phone_last4 does not match"
    }

    // Pull all prior jobs for this customer (most recent first)
    db.query jobs {
      where  = $db.jobs.customer_id == $cust_id
      sort   = {jobs.scheduled_start: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 15}}
    } as $job_rows

    var $items { value = [] }

    foreach ($job_rows.items) {
      each as $j {
        db.query technician_decision_report {
          where  = $db.technician_decision_report.job_id == $j.id
          sort   = {technician_decision_report.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $tdr_rows

        var $tdr_count { value = ($tdr_rows.items|count) }
        var $tdr_diag { value = "" }
        var $tdr_failed { value = "" }
        var $tdr_repair { value = "" }
        var $tdr_part { value = "" }

        conditional {
          if ($tdr_count > 0) {
            var $tdr { value = $tdr_rows.items|get:0 }
            var.update $tdr_diag { value = (($tdr.diagnosis ?? "")|trim) }
            var.update $tdr_failed { value = (($tdr.failed_component ?? "")|trim) }
            var.update $tdr_repair { value = (($tdr.repair_completed ?? "")|trim) }
            var.update $tdr_part { value = (($tdr.verified_part_number ?? "")|trim) }
          }
        }

        var $row {
          value = {
            job_id             : $j.id
            scheduled_start    : ($j.scheduled_start ?? null)
            appliance          : (($j.appliance_type ?? "")|trim)
            brand              : (($j.brand ?? "")|trim)
            problem_summary    : (($j.problem_summary ?? "")|trim)
            scheduling_status  : (($j.scheduling_status ?? "")|trim)
            completed_at       : ($j.job_completed_at ?? null)
            is_current_job     : ($j.id == $jid)
            tdr_diagnosis      : $tdr_diag
            tdr_failed         : $tdr_failed
            tdr_repair         : $tdr_repair
            tdr_part           : $tdr_part
          }
        }
        var.update $items { value = $items|push:$row }
      }
    }
  }

  response = {
    success     : true
    customer_id : $cust_id
    customer_first_name: (($cust.first_name ?? "")|trim)
    count       : ($items|count)
    items       : $items
  }

  guid = "get-my-repair-history-v1"
}
