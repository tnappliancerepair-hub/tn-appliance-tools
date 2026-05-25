query find_recent_completed_warranty_jobs verb=GET {
  api_group = "intake"

  input {
    int? limit?
  }

  stack {
    var $cap {
      value = ($input.limit ?? 5)
    }

    db.query technician_decision_report {
      where = $db.technician_decision_report.diagnosis != null && $db.technician_decision_report.diagnosis != "" && $db.technician_decision_report.failure_cause != null
      sort = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $tdr_rows

    var $matches {
      value = []
    }

    foreach ($tdr_rows.items) {
      each as $tdr {
        conditional {
          if (($matches|count) < $cap) {
            var $tdr_job_id {
              value = ($tdr.job_id ?? 0)
            }

            conditional {
              if ($tdr_job_id > 0) {
                db.get jobs {
                  field_name = "id"
                  field_value = $tdr_job_id
                } as $job

                var $job_cust_type {
                  value = ($job.customer_type ?? "")
                }

                conditional {
                  if (($job != null) && ($job_cust_type == "warranty")) {
                    var $entry_wc {
                      value = ($job.warranty_company ?? "")
                    }

                    var $entry_claim {
                      value = ($job.claim_number ?? "")
                    }

                    var $entry_app {
                      value = ($job.appliance_type ?? "")
                    }

                    var $entry_labor {
                      value = ($tdr.labor_time_hours ?? 0)
                    }

                    var $entry_repair {
                      value = ($tdr.repair_completed ?? "")
                    }

                    var $entry_failed {
                      value = ($tdr.failed_component ?? "")
                    }

                    var $entry {
                      value = {
                        job_id              : $job.id
                        warranty_company    : $entry_wc
                        claim_number        : $entry_claim
                        appliance_type      : $entry_app
                        tdr_id              : $tdr.id
                        tdr_diagnosis       : $tdr.diagnosis
                        tdr_failure_cause   : $tdr.failure_cause
                        tdr_failed_component: $entry_failed
                        tdr_labor_hours     : $entry_labor
                        tdr_repair_completed: $entry_repair
                        job_scheduling_status: ($job.scheduling_status ?? "")
                        job_current_status  : ($job.current_status ?? "")
                        job_created_at      : $job.created_at
                        tdr_created_at      : $tdr.created_at
                      }
                    }

                    var.update $matches {
                      value = $matches|push:$entry
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    success      : true
    matches      : $matches
    tdrs_scanned : ($tdr_rows.items|count)
  }

  guid = "find-recent-completed-warranty-jobs-v1"
}
