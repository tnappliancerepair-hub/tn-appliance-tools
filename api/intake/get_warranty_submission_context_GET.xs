query get_warranty_submission_context verb=GET {
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
          value = {
            success: false
            error  : "job_not_found"
            job_id : $input.job_id
          }
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
  
    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id
      sort = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $tdr_rows
  
    var $tdr {
      value = (($tdr_rows.items|first) ?? null)
    }
  
    var $tdr_id_val {
      value = ($tdr.id ?? 0)
    }
  
    var $tdr_failures {
      value = []
    }
  
    conditional {
      if ($tdr_id_val > 0) {
        db.query tdr_failure {
          where = $db.tdr_failure.tdr_id == $tdr_id_val
          sort = {tdr_failure.created_at: "asc"}
          return = {type: "list", paging: {page: 1, per_page: 50}}
        } as $failure_rows
      
        var.update $tdr_failures {
          value = $failure_rows.items
        }
      }
    }
  }

  response = {
    success     : true
    job         : $job
    customer    : $customer
    tdr         : $tdr
    tdr_failures: $tdr_failures
  }

  guid = "get-warranty-submission-context-v1"
}