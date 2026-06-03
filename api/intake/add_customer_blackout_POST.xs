// Add a customer availability blackout to a job. Called by the
// customer-ant brain (write tool) when the customer tells Ant a
// constraint, OR by the portal UI when they tap-create one.
//
// Storage: JSON-encoded array on jobs.availability_blackouts.
// Each entry has {id, type, description, dow[], start_time, end_time,
// date, all_day, created_at}.
//
// Auth: phone_last4 must match the customer on the job.
query add_customer_blackout verb=POST {
  api_group = "intake"

  input {
    int job_id
    text phone_last4
    text? blackout_type?
    text? description?
    text? dow_csv?
    text? start_time?
    text? end_time?
    text? blackout_date?
    bool? all_day?
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
      value = $stored_phone|right:4
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

    // Decode existing blackouts array (default empty array)
    var $existing_raw {
      value = (($job.availability_blackouts ?? "")|trim)
    }

    var $existing_arr {
      value = []
    }

    conditional {
      if ($existing_raw != "" && $existing_raw != "null") {
        var.update $existing_arr {
          value = ($existing_raw|json_decode)
        }
      }
    }

    // Build the new blackout object
    var $new_id {
      value = "blk_" ~ ((now|to_ms)|to_text) ~ "_" ~ (((rand:1000) + 1000)|to_text)
    }

    var $bk_type {
      value = (($input.blackout_type ?? "one_time")|trim)
    }

    var $bk_desc {
      value = (($input.description ?? "")|trim)
    }

    var $bk_dow_csv {
      value = (($input.dow_csv ?? "")|trim)
    }

    var $bk_dow_arr {
      value = []
    }

    conditional {
      if ($bk_dow_csv != "") {
        var.update $bk_dow_arr {
          value = ($bk_dow_csv|split:",")
        }
      }
    }

    var $bk_start {
      value = (($input.start_time ?? "")|trim)
    }

    var $bk_end {
      value = (($input.end_time ?? "")|trim)
    }

    var $bk_date {
      value = (($input.blackout_date ?? "")|trim)
    }

    var $bk_all_day {
      value = ($input.all_day ?? true)
    }

    var $new_blackout {
      value = {
        id          : $new_id
        type        : $bk_type
        description : $bk_desc
        dow         : $bk_dow_arr
        start_time  : $bk_start
        end_time    : $bk_end
        date        : $bk_date
        all_day     : $bk_all_day
        created_at  : (now|to_ms)
      }
    }

    var $appended_arr {
      value = ($existing_arr|push:$new_blackout)
    }

    var $serialized {
      value = ($appended_arr|json_encode)
    }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        availability_blackouts: $serialized
      }
    } as $updated

    var $audit_payload {
      value = {
        job_id    : $input.job_id
        blackout_id: $new_id
        description: $bk_desc
        type      : $bk_type
        source    : "customer_ant_brain"
      }
    }

    db.add event_log {
      data = {
        action  : "customer_blackout_added"
        metadata: ($audit_payload|json_encode)
      }
    }

    // Emit CUSTOMER_AVAILABILITY_CHANGED so the matcher can try again
    db.add colony_signals {
      data = {
        signal_type    : "CUSTOMER_AVAILABILITY_CHANGED"
        signal_strength: 60
        source_colony  : "customer_portal_ant"
        target_colonies: ""
        payload        : ($audit_payload|json_encode)
      }
    }
  }

  response = {
    success     : true
    blackout_id : $new_id
    description : $bk_desc
    total_count : ($appended_arr|count)
  }

  guid = "add-customer-blackout-v1"
}
