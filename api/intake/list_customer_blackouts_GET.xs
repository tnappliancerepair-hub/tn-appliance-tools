// List a customer's availability blackouts on a job. Called by the
// customer-ant brain (read tool) so Ant can answer "what are my
// blackouts" and reflect them back to the customer.
//
// Auth: phone_last4 must match the customer on the job.
query list_customer_blackouts verb=GET {
  api_group = "intake"

  input {
    int job_id
    text phone_last4
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
      value = $stored_phone|substr:-4:4
    }

    conditional {
      if ($stored_last4 != $supplied_last4) {
        return {
          value = {
            success   : false
            error     : "unauthorized"
            blackouts : []
          }
        }
      }
    }

    var $existing_raw {
      value = (($job.availability_blackouts ?? "")|trim)
    }

    var $blackouts_arr {
      value = []
    }

    conditional {
      if ($existing_raw != "" && $existing_raw != "null") {
        var.update $blackouts_arr {
          value = ($existing_raw|json_decode)
        }
      }
    }
  }

  response = {
    success   : true
    blackouts : $blackouts_arr
    count     : ($blackouts_arr|count)
  }

  guid = "list-customer-blackouts-v1"
}
