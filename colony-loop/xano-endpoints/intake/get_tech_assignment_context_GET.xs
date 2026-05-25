query get_tech_assignment_context verb=GET {
  api_group = "intake"

  input {
    int job_id
    int technician_id
  }

  stack {
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    conditional {
      if ($job == null) {
        return {
          value = {success: false, error: "job_not_found", job_id: $input.job_id}
        }
      }
    }

    db.get technicians {
      field_name = "id"
      field_value = $input.technician_id
    } as $tech

    conditional {
      if ($tech == null) {
        return {
          value = {success: false, error: "tech_not_found", technician_id: $input.technician_id}
        }
      }
    }

    var $customer_id_val {
      value = ($job.customer_id ?? 0)
    }

    var $customer {
      value = null
    }

    conditional {
      if ($customer_id_val > 0) {
        db.get customer {
          field_name = "id"
          field_value = $customer_id_val
        } as $customer_lookup

        var.update $customer {
          value = $customer_lookup
        }
      }
    }
  }

  response = {
    success : true
    job     : $job
    customer: $customer
    tech    : $tech
  }

  guid = "get-tech-assignment-context-v1"
}
