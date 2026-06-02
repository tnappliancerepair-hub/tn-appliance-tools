// Returns the paste-ready field bundle for a CSV of job_ids. Same shape
// as office-today's warranty_submissions_due item — lets warranty-review
// render the same per-field copy-button UI from office-today's
// renderWarrantyCard.
query get_warranty_card_bundle_for_jobs verb=POST {
  api_group = "intake"

  input {
    text job_ids_csv
  }

  stack {
    var $raw    { value = (($input.job_ids_csv ?? "")|trim) }
    var $tokens { value = $raw|split:"," }
    var $out    { value = [] }
    var $now_ms { value = (now|to_ms) }

    foreach ($tokens) {
      each as $tok {
        var $jid_str { value = ($tok ?? "")|trim }
        conditional {
          if ($jid_str != "") {
            var $jid { value = $jid_str|to_int }
            conditional {
              if ($jid > 0) {
                db.get jobs {
                  field_name = "id"
                  field_value = $jid
                } as $job

                conditional {
                  if ($job != null) {
                    var $cust_id { value = ($job.customer_id ?? 0) }
                    var $cust    { value = null }
                    conditional {
                      if ($cust_id > 0) {
                        db.get customer {
                          field_name = "id"
                          field_value = $cust_id
                        } as $cust_lookup
                        var.update $cust { value = $cust_lookup }
                      }
                    }

                    var $tech_id { value = ($job.technician_id ?? 0) }
                    var $tech    { value = null }
                    conditional {
                      if ($tech_id > 0) {
                        db.get technicians {
                          field_name = "id"
                          field_value = $tech_id
                        } as $tech_lookup
                        var.update $tech { value = $tech_lookup }
                      }
                    }

                    db.query technician_decision_report {
                      where = $db.technician_decision_report.job_id == $jid
                      sort = {technician_decision_report.created_at: "desc"}
                      return = {type: "list", paging: {page: 1, per_page: 1}}
                    } as $tdr_rows

                    var $tdr { value = (($tdr_rows.items|first) ?? null) }

                    var.update $out {
                      value = $out|push:{
                        job_id          : $job.id
                        claim_number    : ($job.ahs_claim_number ?? "")
                        dispatch_id     : ($job.dispatch_source_id ?? "")
                        warranty_company: ($job.warranty_company ?? "")
                        customer        : $cust
                        tech            : $tech
                        appliance_type  : ($job.appliance_type ?? "")
                        brand           : ($job.brand ?? "")
                        model_number    : ($job.model_number ?? "")
                        serial_number   : ($job.serial_number ?? "")
                        problem_summary : ($job.problem_summary ?? "")
                        tdr             : $tdr
                        job_completed_at: ($job.job_completed_at ?? 0)
                        age_hours       : (($now_ms - ($job.job_completed_at ?? $now_ms)) / 3600000)
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
  }

  response = {
    success : true
    bundles : $out
    count   : ($out|count)
  }

  guid = "get-warranty-card-bundle-for-jobs-v1"
}
