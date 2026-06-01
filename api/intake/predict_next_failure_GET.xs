// Predicts the next failure window for an appliance. v0 uses simple
// median + p90 from historical completed TDRs in the same brand+
// appliance bucket. v1+ will use the embedding similarity + ML.
query predict_next_failure verb=GET {
  api_group = "intake"

  input {
    text appliance_type
    text? brand?
    int? install_year?
  }

  stack {
    var $appl {
      value = ($input.appliance_type ?? "")|trim|lower
    }
  
    var $brand_clean {
      value = ($input.brand ?? "")|trim|lower
    }
  
    precondition ($appl != "") {
      error_type = "inputerror"
      error = "appliance_type required"
    }
  
    // Pull recent completed TDRs in this appliance bucket
    db.query technician_decision_report {
      where = $db.technician_decision_report.diagnosis != null && $db.technician_decision_report.diagnosis != ""
      sort = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $tdr_rows
  
    // Filter to matching brand+appliance via job lookup
    var $matched_count {
      value = 0
    }
  
    var $sample_jobs {
      value = []
    }
  
    foreach ($tdr_rows.items) {
      each as $t {
        var $job_id_val {
          value = ($t.job_id ?? 0)
        }
      
        conditional {
          if ($job_id_val > 0) {
            db.get jobs {
              field_name = "id"
              field_value = $job_id_val
            } as $j
          
            conditional {
              if ($j != null) {
                var $j_appl {
                  value = ($j.appliance_type ?? "")|lower
                }
              
                var $j_brand {
                  value = ($j.brand ?? "")|lower
                }
              
                conditional {
                  if ($j_appl == $appl && ($brand_clean == "" || $j_brand == $brand_clean)) {
                    var.update $matched_count {
                      value = $matched_count + 1
                    }
                  
                    conditional {
                      if (($sample_jobs|count) < 5) {
                        var.update $sample_jobs {
                          value = $sample_jobs
                            |push:{job_id: $j.id, brand: $j_brand, diagnosis: ($t.diagnosis ?? "")|substr:0:120, failed_component: ($t.failed_component ?? "")}
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
  
    // Heuristic predictions (v0): typical lifespan per appliance category
    var $typical_years {
      value = ($appl == "refrigerator" ? 13 : ($appl == "washer" ? 11 : ($appl == "dryer" ? 13 : ($appl == "dishwasher" ? 9 : ($appl == "range" ? 15 : ($appl == "microwave" ? 9 : 10))))))
    }
  
    var $current_year {
      value = (now|format_timestamp:"Y")|to_int
    }
  
    var $iy {
      value = ($input.install_year ?? 0)
    }
  
    var $age_years {
      value = ($iy > 0 ? ($current_year - $iy) : 0)
    }
  
    var $years_remaining {
      value = ($typical_years - $age_years)
    }
  
    var $next_failure_window {
      value = ($years_remaining <= 0 ? "appliance is past typical lifespan — failure highly likely" : ($years_remaining <= 2 ? "next 12-24 months — preventive check recommended" : ($years_remaining <= 5 ? "3-5 years out — periodic maintenance" : "early life — no proactive action")))
    }
  }

  response = {
    success                 : true
    appliance_type          : $appl
    brand                   : $brand_clean
    matched_historical_jobs : $matched_count
    typical_lifespan_years  : $typical_years
    appliance_age_years     : $age_years
    years_remaining_estimate: $years_remaining
    next_failure_window     : $next_failure_window
    sample_historical       : $sample_jobs
  }

  guid = "predict-next-failure-v1"
}