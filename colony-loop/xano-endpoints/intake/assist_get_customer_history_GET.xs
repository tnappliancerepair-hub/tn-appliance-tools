// Returns prior service history for a customer — used by tech-assist-brain
// as a Claude tool. When the tech is at a customer's house, Claude can
// pull this to say "Andre was here 8 months ago, replaced the inverter
// board for the same complaint — check if that's re-failed first."
//
// Returns: list of prior jobs (up to 10 most recent, excluding current
// job) with appliance, status, tech name, TDR summary (diagnosis +
// failed component + repair completed).
query assist_get_customer_history verb=GET {
  api_group = "intake"

  input {
    int customer_id
    int? exclude_job_id?
    int? limit?
  }

  stack {
    var $cust_id { value = ($input.customer_id ?? 0) }
    var $exclude { value = ($input.exclude_job_id ?? 0) }
    var $lim_raw { value = ($input.limit ?? 10) }
    var $lim { value = ($lim_raw > 25) ? 25 : $lim_raw }

    precondition ($cust_id > 0) {
      error_type = "inputerror"
      error      = "customer_id required"
    }

    db.query jobs {
      where  = $db.jobs.customer_id == $cust_id
      sort   = {jobs.scheduled_start: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $job_rows

    var $items { value = [] }

    foreach ($job_rows.items) {
      each as $j {
        conditional {
          if ($j.id != $exclude) {
            // Pull the TDR for this job (if any) from the TDR side —
            // jobs.technician_decision_report_id is unreliable per
            // CLAUDE.md footgun catalog. Query technician_decision_report
            // by job_id.
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
            var $tdr_tech_id { value = 0 }
            var $tdr_labor { value = 0 }

            conditional {
              if ($tdr_count > 0) {
                var $tdr { value = $tdr_rows.items|get:0 }
                var.update $tdr_diag { value = (($tdr.diagnosis ?? "")|trim) }
                var.update $tdr_failed { value = (($tdr.failed_component ?? "")|trim) }
                var.update $tdr_repair { value = (($tdr.repair_completed ?? "")|trim) }
                var.update $tdr_part { value = (($tdr.verified_part_number ?? "")|trim) }
                var.update $tdr_tech_id { value = ($tdr.technician_id ?? 0) }
                var.update $tdr_labor { value = ($tdr.labor_time_hours ?? 0) }
              }
            }

            // Tech name from technicians table (cheap lookup)
            var $tech_first { value = "" }
            conditional {
              if ($tdr_tech_id > 0) {
                db.get technicians {
                  field_name  = "id"
                  field_value = $tdr_tech_id
                } as $tech_row
                var.update $tech_first { value = (($tech_row.first_name ?? "")|trim) }
              }
            }

            var $row {
              value = {
                job_id              : $j.id
                scheduled_start     : ($j.scheduled_start ?? null)
                appliance           : (($j.appliance_type ?? "")|trim)
                brand               : (($j.brand ?? "")|trim)
                model               : (($j.model ?? "")|trim)
                problem_summary     : (($j.problem_summary ?? "")|trim)
                scheduling_status   : (($j.scheduling_status ?? "")|trim)
                completed_at        : ($j.job_completed_at ?? null)
                tdr_diagnosis       : $tdr_diag
                tdr_failed_component: $tdr_failed
                tdr_repair          : $tdr_repair
                tdr_part_number     : $tdr_part
                tdr_labor_hours     : $tdr_labor
                tech_first_name     : $tech_first
              }
            }

            var.update $items { value = $items|push:$row }
          }
        }
      }
    }
  }

  response = {
    success    : true
    customer_id: $cust_id
    count      : ($items|count)
    items      : $items
  }

  guid = "assist-get-customer-history-v1"
}
