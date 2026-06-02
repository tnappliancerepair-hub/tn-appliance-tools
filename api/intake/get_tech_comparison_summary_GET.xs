// Per-tech aggregates for the last N days. Feeds tech_comparison_report.
//   - jobs completed
//   - revenue (sum of total_amount_cents on completed jobs)
//   - avg ticket
//   - tdr_completeness_pct (TDRs with all 4 core fields populated)
query get_tech_comparison_summary verb=GET {
  api_group = "intake"

  input {
    int? days_back?
  }

  stack {
    var $days   { value = ($input.days_back ?? 30) }
    var $cutoff { value = (now|to_ms) - ($days * 86400000) }

    db.query technicians {
      where = $db.technicians.active == true
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $techs_raw

    var $rows { value = [] }

    foreach ($techs_raw.items) {
      each as $t {
        conditional {
          if ($t.id != 8) {
            db.query jobs {
              where = $db.jobs.technician_id == $t.id && $db.jobs.job_completed_at >= $cutoff && $db.jobs.scheduling_status == "completed"
              return = {type: "list", paging: {page: 1, per_page: 500}}
            } as $jobs_q

            var $jobs_done  { value = ($jobs_q.items|count) }
            var $revenue    { value = 0 }
            foreach ($jobs_q.items) {
              each as $j {
                var.update $revenue { value = $revenue + ($j.total_amount_cents ?? 0) }
              }
            }

            db.query technician_decision_report {
              where = $db.technician_decision_report.technician_id == $t.id && $db.technician_decision_report.created_at >= $cutoff
              return = {type: "list", paging: {page: 1, per_page: 500}}
            } as $tdr_q

            var $tdr_count   { value = ($tdr_q.items|count) }
            var $tdr_complete { value = 0 }
            foreach ($tdr_q.items) {
              each as $r {
                var $d  { value = (($r.diagnosis ?? "")|trim) }
                var $fc { value = (($r.failed_component ?? "")|trim) }
                var $lt { value = ($r.labor_time_hours ?? 0) }
                var $rc { value = (($r.repair_completed ?? "")|trim) }
                conditional {
                  if ($d != "" && $fc != "" && $lt > 0 && $rc != "") {
                    var.update $tdr_complete { value = $tdr_complete + 1 }
                  }
                }
              }
            }

            var.update $rows {
              value = $rows|push:{
                tech_id          : $t.id
                first_name       : ($t.first_name ?? "")
                last_name        : ($t.last_name ?? "")
                jobs_completed   : $jobs_done
                revenue_cents    : $revenue
                avg_ticket_cents : ($jobs_done > 0) ? ($revenue / $jobs_done) : 0
                tdrs_written     : $tdr_count
                tdrs_complete    : $tdr_complete
              }
            }
          }
        }
      }
    }
  }

  response = {
    success   : true
    days_back : $days
    techs     : $rows
  }

  guid = "get-tech-comparison-summary-v1"
}
