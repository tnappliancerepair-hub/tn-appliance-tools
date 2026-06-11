// Remove a customer availability blackout from a job by blackout_id.
// Called by the customer-ant brain (write tool) when the customer
// tells Ant "actually I can do Tuesday after all", or by the portal
// UI when they tap to delete.
//
// Auth: phone_last4 must match the customer on the job.
query remove_customer_blackout verb=POST {
  api_group = "intake"

  input {
    int job_id
    text phone_last4
    text blackout_id
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

    var $target_id {
      value = (($input.blackout_id ?? "")|trim)
    }

    precondition ($target_id != "") {
      error_type = "inputerror"
      error = "blackout_id is required"
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

    // Filter out the blackout with matching id
    var $filtered_arr {
      value = []
    }

    var $removed_count {
      value = 0
    }

    foreach ($existing_arr) {
      each as $b {
        var $bid {
          value = ($b.id ?? "")
        }
        conditional {
          if ($bid != $target_id) {
            var.update $filtered_arr {
              value = ($filtered_arr|push:$b)
            }
          }
        }
        conditional {
          if ($bid == $target_id) {
            var.update $removed_count {
              value = ($removed_count + 1)
            }
          }
        }
      }
    }

    var $serialized {
      value = ($filtered_arr|json_encode)
    }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        availability_blackouts: $serialized
      }
    } as $updated

    db.add event_log {
      data = {
        action  : "customer_blackout_removed"
        metadata: ({job_id: $input.job_id, blackout_id: $target_id, removed_count: $removed_count, source: "customer_ant_brain"}|json_encode)
      }
    }

    db.add colony_signals {
      data = {
        signal_type    : "CUSTOMER_AVAILABILITY_CHANGED"
        signal_strength: 60
        source_colony  : "customer_portal_ant"
        target_colonies: ""
        payload        : ({job_id: $input.job_id, source: "blackout_removed"}|json_encode)
      }
    }
  }

  response = {
    success        : true
    removed_count  : $removed_count
    remaining_count: ($filtered_arr|count)
  }

  guid = "remove-customer-blackout-v1"
}
