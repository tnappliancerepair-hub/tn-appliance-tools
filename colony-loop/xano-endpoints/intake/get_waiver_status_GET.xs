// Returns waiver state + prefill fields for the waiver_due agent.
// Used to (a) check if the customer has already signed (skip path)
// and (b) compose the SMS body without an extra round-trip.
query get_waiver_status verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    conditional {
      if ($job == null) {
        return {
          value = {success: false, error: "job_not_found"}
        }
      }
    }

    var $cust_id_val {
      value = ($job.customer_id ?? 0)
    }

    var $customer { value = null }

    conditional {
      if ($cust_id_val > 0) {
        db.get customer {
          field_name = "id"
          field_value = $cust_id_val
        } as $customer_lookup

        var.update $customer {
          value = $customer_lookup
        }
      }
    }
  }

  response = {
    success           : true
    job_id            : $job.id
    scheduling_status : ($job.scheduling_status ?? "")
    waiver_signed     : ($job.waiver_signed ?? false)
    waiver_signed_at  : ($job.waiver_signed_at ?? 0)
    waiver_sent_at    : ($job.waiver_sent_at ?? 0)
    customer          : {
      id        : ($customer.id ?? 0)
      first_name: ($customer.first_name ?? "")
      phone     : ($customer.phone ?? "")
    }
  }

  guid = "get-waiver-status-v1"
}
