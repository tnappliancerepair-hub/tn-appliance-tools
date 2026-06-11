//  Customer-portal availability tap-grid update.
//  Customer taps blocks on customer-portal.html → debounced POST here.
//  Validates phone_last4 (same auth as update_job_from_chat).
//  Persists JSON grid + numeric flex_score on jobs row.
//  Emits CUSTOMER_AVAILABILITY_CHANGED colony_signal so Block 6's
//  customer_availability_opens agent can check for sooner slots.
query update_customer_availability_grid verb=POST {
  api_group = "intake"

  input {
    int job_id
    text phone_last4
    text availability_grid
    int? flex_score?
  }

  stack {
    precondition ($input.job_id != null && $input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id is required"
    }

    var $supplied_last4 {
      value = (($input.phone_last4 ?? "")|trim)
    }

    precondition ($supplied_last4 != "") {
      error_type = "inputerror"
      error = "phone_last4 is required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    // Waiver gate — customer cannot set availability until they sign
    // the release of liability at /waiver.html. The customer-portal UI
    // shows a modal pointing them there. Backend defends in depth.
    var $waiver_ts { value = ($job.waiver_signed_at ?? 0) }
    precondition ($waiver_ts > 0) {
      error_type = "accessdenied"
      error = "Please sign the release of liability before scheduling. Open the waiver link in your appointment text."
    }

    var $customer {
      value = null
    }

    conditional {
      if ($job.customer_id != null && $job.customer_id > 0) {
        db.get customer {
          field_name = "id"
          field_value = $job.customer_id
        } as $customer
      }
    }

    var $stored_phone {
      value = (($customer.phone ?? "")|trim)
    }

    var $stored_last4 {
      value = $stored_phone|substr:-4:4
    }

    conditional {
      if ($stored_last4 != $supplied_last4) {
        return {
          value = {
            success: false
            error  : "unauthorized"
          }
        }
      }
    }

    var $grid_str {
      value = (($input.availability_grid ?? "[]")|trim)
    }

    var $flex {
      value = ($input.flex_score ?? 0)
    }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        customer_availability_grid: $grid_str
        flex_score               : $flex
      }
    } as $updated_job

    var $payload_str {
      value = ```
        {
          job_id          : $input.job_id
          customer_id     : ($job.customer_id ?? 0)
          flex_score      : $flex
          grid            : $grid_str
          source          : "customer_portal"
        }|json_encode
        ```
    }

    db.add colony_signals {
      data = {
        signal_type    : "CUSTOMER_AVAILABILITY_CHANGED"
        signal_strength: 60
        source_colony  : "customer_portal"
        target_colonies: ""
        payload        : $payload_str
      }
    } as $signal_row

    db.add event_log {
      data = {
        action  : "customer_availability_grid_updated"
        metadata: ```
          {
            job_id      : $input.job_id
            flex_score  : $flex
            signal_id   : ($signal_row.id ?? 0)
          }|json_encode
          ```
      }
    }
  }

  response = {
    success   : true
    job_id    : $input.job_id
    flex_score: $flex
  }

  guid = "update-customer-availability-grid-v1"
}
