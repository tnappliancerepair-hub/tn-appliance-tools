// Cleans a phone number to E.164 format, looks up the customer, and returns their most recent job.
query get_job_by_phone verb=GET {
  api_group = "intake"

  input {
    // The phone number to search for.
    // The customer's phone number
    text phone_number
  }

  stack {
    // Clean the phone number to E.164 format.
    // Strip all non-digit characters.
    var $digits {
      value = "/[^0-9]/"
        |regex_replace:"":$input.phone_number
    }
  
    var $clean_phone {
      value = ""
    }
  
    conditional {
      // If 10 digits, assume US and prepend +1.
      if (($digits|strlen) == 10) {
        var.update $clean_phone {
          value = "+1" ~ $digits
        }
      }
    
      // If 11 digits and starts with 1, prepend +.
      elseif ((($digits|strlen) == 11) && ($digits|starts_with:"1")) {
        var.update $clean_phone {
          value = "+" ~ $digits
        }
      }
    
      // Otherwise just prepend + and hope for the best.
      else {
        var.update $clean_phone {
          value = "+" ~ $digits
        }
      }
    }
  
    // Look up the customer record where phone matches the cleaned or raw number.
    db.query customer {
      where = $db.customer.phone == $clean_phone || $db.customer.phone == $input.phone_number
      return = {type: "single"}
    } as $customer
  
    // If no customer is found, return a 404 error.
    precondition ($customer != null) {
      error_type = "notfound"
      error = "Customer not found"
    }
  
    // Look up the most recent job record for this customer.
    db.query jobs {
      where = $db.jobs.customer_id == $customer.id
      sort = {created_at: "desc"}
      return = {type: "single"}
    } as $job
  
    // If a job exists, we could pick just the requested fields, but the requirement 
    // says to include them, and they are already part of the job record.
    // current_status, warranty_company, appliance_type, part_eta, 
    // scheduled_start, technician_id, triage_status, vapi_call_status.
  }

  response = {customer: $customer, job: $job}
  guid = "TOw80uBsQl0f6UxFedmBpte7h10"
}