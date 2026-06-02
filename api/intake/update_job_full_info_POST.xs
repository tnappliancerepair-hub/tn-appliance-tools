// Lets Danielle edit ALL key fields on a job from job-detail.html.
// Updates both customer + job in one round-trip. Office-password gated.
// Only sets fields that were actually provided; missing fields keep their
// existing value.
query update_job_full_info verb=POST {
  api_group = "intake"

  input {
    int job_id
    text office_password
    text? first_name?
    text? last_name?
    text? phone?
    text? email?
    text? address?
    text? city?
    text? state?
    text? zip?
    text? appliance_type?
    text? brand?
    text? model_number?
    text? serial_number?
    text? problem_summary?
    text? warranty_company?
    text? claim_number?
    text? dispatch_number?
    text? customer_type?
  }

  stack {
    var $env_pw {
      value = (($env.OFFICE_PASSWORD ?? "antlives")|trim)
    }

    var $supplied_pw {
      value = (($input.office_password ?? "")|trim)
    }

    conditional {
      if ($env_pw == "" || $env_pw != $supplied_pw) {
        return {
          value = { success: false, error: "unauthorized" }
        }
      }
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    conditional {
      if ($job == null) {
        return {
          value = { success: false, error: "job_not_found" }
        }
      }
    }

    var $cust_id {
      value = ($job.customer_id ?? 0)
    }

    db.get customer {
      field_name = "id"
      field_value = $cust_id
    } as $cust

    conditional {
      if ($cust != null) {
        db.edit customer {
          field_name = "id"
          field_value = $cust_id
          data = {
            first_name: ((($input.first_name|to_text) ?? "") != "") ? (($input.first_name|to_text) ?? "") : (($cust.first_name|to_text) ?? "")
            last_name : ((($input.last_name|to_text) ?? "") != "") ? (($input.last_name|to_text) ?? "") : (($cust.last_name|to_text) ?? "")
            phone     : ((($input.phone|to_text) ?? "") != "") ? (($input.phone|to_text) ?? "") : (($cust.phone|to_text) ?? "")
            email     : ((($input.email|to_text) ?? "") != "") ? (($input.email|to_text) ?? "") : (($cust.email|to_text) ?? "")
            address   : ((($input.address|to_text) ?? "") != "") ? (($input.address|to_text) ?? "") : (($cust.address|to_text) ?? "")
            city      : ((($input.city|to_text) ?? "") != "") ? (($input.city|to_text) ?? "") : (($cust.city|to_text) ?? "")
            state     : ((($input.state|to_text) ?? "") != "") ? (($input.state|to_text) ?? "") : (($cust.state|to_text) ?? "")
            zip       : ((($input.zip|to_text) ?? "") != "") ? (($input.zip|to_text) ?? "") : (($cust.zip|to_text) ?? "")
          }
        }
      }
    }

    db.edit jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        appliance_type    : ((($input.appliance_type|to_text) ?? "") != "") ? (($input.appliance_type|to_text) ?? "") : (($job.appliance_type|to_text) ?? "")
        brand             : ((($input.brand|to_text) ?? "") != "") ? (($input.brand|to_text) ?? "") : (($job.brand|to_text) ?? "")
        model_number      : ((($input.model_number|to_text) ?? "") != "") ? (($input.model_number|to_text) ?? "") : (($job.model_number|to_text) ?? "")
        serial_number     : ((($input.serial_number|to_text) ?? "") != "") ? (($input.serial_number|to_text) ?? "") : (($job.serial_number|to_text) ?? "")
        problem_summary   : ((($input.problem_summary|to_text) ?? "") != "") ? (($input.problem_summary|to_text) ?? "") : (($job.problem_summary|to_text) ?? "")
        warranty_company  : ((($input.warranty_company|to_text) ?? "") != "") ? (($input.warranty_company|to_text) ?? "") : (($job.warranty_company|to_text) ?? "")
        claim_number      : ((($input.claim_number|to_text) ?? "") != "") ? (($input.claim_number|to_text) ?? "") : (($job.claim_number|to_text) ?? "")
        dispatch_source_id: ((($input.dispatch_number|to_text) ?? "") != "") ? (($input.dispatch_number|to_text) ?? "") : (($job.dispatch_source_id|to_text) ?? "")
        customer_type     : ((($input.customer_type|to_text) ?? "") != "") ? (($input.customer_type|to_text) ?? "") : (($job.customer_type|to_text) ?? "")
        service_address   : ((($input.address|to_text) ?? "") != "") ? (($input.address|to_text) ?? "") : (($job.service_address|to_text) ?? "")
        service_city      : ((($input.city|to_text) ?? "") != "") ? (($input.city|to_text) ?? "") : (($job.service_city|to_text) ?? "")
        service_state     : ((($input.state|to_text) ?? "") != "") ? (($input.state|to_text) ?? "") : (($job.service_state|to_text) ?? "")
        service_zip       : ((($input.zip|to_text) ?? "") != "") ? (($input.zip|to_text) ?? "") : (($job.service_zip|to_text) ?? "")
      }
    }

    db.add event_log {
      data = {
        action  : "job_full_info_updated"
        metadata: ```
          {
            job_id: $input.job_id
          }|json_encode
          ```
      }
    }
  }

  response = {
    success: true
    job_id : $input.job_id
  }

  guid = "update-job-full-info-v1"
}
