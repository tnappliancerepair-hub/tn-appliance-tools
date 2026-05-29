// SAVE OFFLINE TDR
//
// Offline-first TDR submission path. The tech-ant-offline.html page
// captures TDR fields + photos locally in IndexedDB while disconnected,
// then on sync POSTs here. Idempotent via client_idempotency_key so
// retries do not duplicate rows.
//
// Writes to technician_decision_report (the same table as create_tdr).
// Skips side effects (Danielle SMS, parts router, HCP note) intentionally.
// Side effects fire only when a tech-side flow chooses to mark COMPLETE
// via tech_job_complete; the offline path is store-and-forward only.

query save_offline_tdr verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id?
    text client_idempotency_key filters=trim
    text diagnosis?
    text failed_component?
    text failure_cause?
    text technician_notes?
    text problem_summary?
    text verified_part_number?
    text repair_completed?
    decimal labor_time_hours?
    text model_number_typed?
    text model_confirmation?
    text symptom_confirmation?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id is required"
    }

    precondition ($input.client_idempotency_key != "") {
      error_type = "inputerror"
      error = "client_idempotency_key is required"
    }

    db.query technician_decision_report {
      where = $db.technician_decision_report.client_idempotency_key == $input.client_idempotency_key
      return = {type: "list"}
    } as $existing_rows

    var $existing {
      value = (($existing_rows.items|first) ?? null)
    }

    var $tdr_id {
      value = 0
    }

    var $reused {
      value = false
    }

    conditional {
      if ($existing != null) {
        var.update $tdr_id {
          value = $existing.id
        }
        var.update $reused {
          value = true
        }
      }
    }

    conditional {
      if ($existing == null) {
        var $packed_summary {
          value = ($input.problem_summary ?? "")
        }

        var $model_typed {
          value = (($input.model_number_typed ?? "")|trim)
        }

        var $model_conf {
          value = (($input.model_confirmation ?? "")|trim)
        }

        var $symptom_conf {
          value = (($input.symptom_confirmation ?? "")|trim)
        }

        conditional {
          if ($model_typed != "") {
            var.update $packed_summary {
              value = ($packed_summary ~ "\nModel typed by tech: " ~ $model_typed)
            }
          }
        }

        conditional {
          if ($model_conf != "") {
            var.update $packed_summary {
              value = ($packed_summary ~ "\nModel confirmed: " ~ $model_conf)
            }
          }
        }

        conditional {
          if ($symptom_conf != "") {
            var.update $packed_summary {
              value = ($packed_summary ~ "\nSymptom confirmed: " ~ $symptom_conf)
            }
          }
        }

        db.add technician_decision_report {
          data = {
            job_id                 : $input.job_id
            report_date            : now
            technician_id          : $input.technician_id
            diagnosis              : $input.diagnosis
            failed_component       : $input.failed_component
            failure_cause          : $input.failure_cause
            technician_notes       : $input.technician_notes
            problem_summary        : $packed_summary
            verified_part_number   : $input.verified_part_number
            repair_completed       : $input.repair_completed
            labor_time_hours       : $input.labor_time_hours
            status                 : "offline_sync"
            client_idempotency_key : $input.client_idempotency_key
          }
        } as $new_row

        var.update $tdr_id {
          value = $new_row.id
        }
      }
    }

    db.add event_log {
      data = {
        action: "offline_tdr_sync"
        metadata: {
          tdr_id                 : $tdr_id
          job_id                 : $input.job_id
          technician_id          : ($input.technician_id ?? null)
          client_idempotency_key : $input.client_idempotency_key
          reused                 : $reused
        }
      }
    } as $audit
  }

  response = {
    success                : true
    tdr_id                 : $tdr_id
    reused                 : $reused
    client_idempotency_key : $input.client_idempotency_key
  }
}
