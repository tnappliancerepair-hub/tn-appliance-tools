// Customer-side action endpoint for customer-portal.html. Two actions:
//   - "reschedule" : emits RESCHEDULE_REQUEST_ALERT (existing agent SMSes
//                    Teddy + Danielle and writes the audit row)
//   - "add_notes"  : updates jobs.access_notes (gate codes, pets, etc.)
//
// Phone-last4 gate matches the read endpoint. POST keeps the last4 out
// of access logs.
query customer_portal_action verb=POST {
  api_group = "intake"

  input {
    int job_id
    text phone_last4
    text action
    text? body?
  }

  stack {
    var $supplied_last4 {
      value = (($input.phone_last4 ?? "")|trim)
    }

    precondition ($supplied_last4 != "") {
      error_type = "inputerror"
      error      = "phone_last4 is required"
    }

    var $action {
      value = (($input.action ?? "")|trim|lower)
    }

    precondition ($action == "reschedule" || $action == "add_notes") {
      error_type = "inputerror"
      error      = "action must be reschedule or add_notes"
    }

    var $body_text {
      value = (($input.body ?? "")|trim)
    }

    precondition ($body_text != "") {
      error_type = "inputerror"
      error      = "body is required"
    }

    db.get jobs {
      field_name  = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error      = "Job not found"
    }

    var $customer { value = null }

    conditional {
      if ($job.customer_id != null && $job.customer_id > 0) {
        db.get customer {
          field_name  = "id"
          field_value = $job.customer_id
        } as $customer
      }
    }

    precondition ($customer != null) {
      error_type = "notfound"
      error      = "Customer not found for this job"
    }

    var $stored_digits {
      value = (($customer.phone ?? "")|replace:"+":""|replace:"-":""|replace:"(":""|replace:")":""|replace:" ":"")
    }

    var $stored_len {
      value = ($stored_digits|strlen)
    }

    var $stored_last4_start {
      value = ($stored_len - 4)
    }

    var $stored_last4 { value = "" }

    conditional {
      if ($stored_len >= 4) {
        var.update $stored_last4 {
          value = ($stored_digits|substr:$stored_last4_start)
        }
      }
    }

    precondition ($stored_last4 != "" && $stored_last4 == $supplied_last4) {
      error_type = "unauthorized"
      error      = "phone_last4 does not match"
    }

    // ── reschedule path ─────────────────────────────────────────
    var $first_name_safe {
      value = ($customer.first_name ?? "")
    }

    var $appliance_safe {
      value = ($job.appliance ?? "")
    }

    var $signal_payload_obj {
      value = {
        job_id          : $input.job_id
        customer_id     : $customer.id
        customer_phone  : ($customer.phone ?? "")
        first_name      : $first_name_safe
        appliance_type  : $appliance_safe
        body            : $body_text
        source          : "customer_portal"
        source_action   : $action
      }
    }

    var $payload_json {
      value = $signal_payload_obj|json_encode
    }

    var $signal_id { value = 0 }

    conditional {
      if ($action == "reschedule") {
        db.add colony_signals {
          data = {
            signal_type     : "RESCHEDULE_REQUEST_ALERT"
            signal_strength : 80
            source_colony   : "customer_portal"
            target_colonies : ""
            payload         : $payload_json
          }
        } as $signal_row

        var.update $signal_id {
          value = ($signal_row.id ?? 0)
        }
      }
    }

    // ── add_notes path ──────────────────────────────────────────
    conditional {
      if ($action == "add_notes") {
        // Append to existing access_notes if present, separated by newline
        var $existing_notes {
          value = (($job.access_notes ?? "")|trim)
        }

        var $merged_notes {
          value = ($existing_notes != "" ? ($existing_notes ~ "\n" ~ $body_text) : $body_text)
        }

        db.edit jobs {
          field_name  = "id"
          field_value = $input.job_id
          data        = {
            access_notes: $merged_notes
          }
        } as $updated_job
      }
    }

    // ── audit ────────────────────────────────────────────────────
    var $event_meta_obj {
      value = {
        job_id        : $input.job_id
        customer_id   : $customer.id
        action        : $action
        body_preview  : ($body_text|substr:0:200)
        signal_id     : $signal_id
        source        : "customer_portal"
      }
    }

    var $event_meta_json {
      value = $event_meta_obj|json_encode
    }

    db.add event_log {
      data = {
        action      : "customer_portal_action"
        metadata    : $event_meta_json
      }
    } as $event_row
  }

  response = {
    success      : true
    action       : $action
    job_id       : $input.job_id
    signal_id    : $signal_id
  }

  guid = "customer-portal-action-v1"
}
