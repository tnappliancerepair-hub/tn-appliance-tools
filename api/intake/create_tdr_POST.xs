query create_tdr verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id?
    text technician_first_name? filters=trim
    text technician_last_name? filters=trim
    text confidence_level? filters=trim
    text verified_part_number? filters=trim
    text part_number_confidence? filters=trim
    text estimated_repair_cost_range? filters=trim
    text diy_feasibility_rating? filters=trim
    text final_recommendation? filters=trim
    text technician_notes? filters=trim
    text problem_summary? filters=trim
    text status? filters=trim
    text report_url? filters=trim
    text repair_completed?
    text repair_not_completed_reason?
    json parts_used?
    json parts_not_used?
    decimal labor_time_hours?
    bool second_visit_needed?
    json part_name_only_flags?
    text failure_cause?
    text failure_cause_notes?
    text diagnostic_test_performed?
    text? diagnosis?
    text failed_component?
    text customer_facing_diagnosis?
    text mode?
    text failure_description? filters=trim
    text oem_part_number? filters=trim
    text amazon_part_number? filters=trim
    int oem_part_our_cost_cents?
    int amazon_part_our_cost_cents?
    int labor_customer_cost_cents?
    text client_idempotency_key? filters=trim
  }

  stack {
    var $idem_key {
      value = ($input.client_idempotency_key ?? "")
    }

    var $reuse_tdr {
      value = null
    }

    conditional {
      if ($idem_key != "") {
        db.query technician_decision_report {
          where = $db.technician_decision_report.client_idempotency_key == $idem_key
          return = {type: "list"}
        } as $existing_rows

        var $found_existing {
          value = (($existing_rows|first) ?? null)
        }

        conditional {
          if ($found_existing != null) {
            var.update $reuse_tdr {
              value = $found_existing
            }
          }
        }
      }
    }

    var $new_tdr {
      value = null
    }

    conditional {
      if ($reuse_tdr == null) {
        db.add technician_decision_report {
          data = {
            job_id                     : $input.job_id
            report_date                : now
            technician_id              : $input.technician_id
            technician_first_name      : $input.technician_first_name
            technician_last_name       : $input.technician_last_name
            confidence_level           : $input.confidence_level
            verified_part_number       : $input.verified_part_number
            part_number_confidence     : $input.part_number_confidence
            estimated_repair_cost_range: $input.estimated_repair_cost_range
            diy_feasibility_rating     : $input.diy_feasibility_rating
            final_recommendation       : $input.final_recommendation
            technician_notes           : $input.technician_notes
            problem_summary            : $input.problem_summary
            status                     : $input.status
            report_url                 : $input.report_url
            repair_completed           : $input.repair_completed
            repair_not_completed_reason: $input.repair_not_completed_reason
            parts_used                 : $input.parts_used
            parts_not_used             : $input.parts_not_used
            labor_time_hours           : $input.labor_time_hours
            second_visit_needed        : $input.second_visit_needed
            part_name_only_flags       : $input.part_name_only_flags
            failure_cause              : $input.failure_cause
            failure_cause_notes        : $input.failure_cause_notes
            diagnostic_test_performed  : $input.diagnostic_test_performed
            diagnosis                  : $input.diagnosis
            failed_component           : $input.failed_component
            customer_facing_diagnosis  : $input.customer_facing_diagnosis
            client_idempotency_key     : $idem_key
          }
        } as $new_tdr_row

        var.update $new_tdr {
          value = $new_tdr_row
        }
      }
    }

    var $result_tdr {
      value = ($reuse_tdr ?? $new_tdr)
    }

    db.add event_log {
      data = {
        action: "create_tdr_minimal"
        metadata: {
          tdr_id                 : $result_tdr.id
          job_id                 : $input.job_id
          technician_id          : ($input.technician_id ?? null)
          client_idempotency_key : $idem_key
          reused                 : ($reuse_tdr != null)
          mode                   : ($input.mode ?? "completion")
        }
      }
    } as $audit_log
  }

  response = {
    tdr           : ($reuse_tdr ?? $new_tdr)
    tdr_failure_id: null
    hcp_sync      : null
    sms_response  : null
    mode          : ($input.mode ?? "completion")
    reused        : ($reuse_tdr != null)
  }

  guid = "qAQK3BtYtScefCVFBke4MGut26Q"
}
