// This endpoint triggers an outbound Vapi call for a specific job.
// It retrieves job and customer details, determines the appropriate Vapi phone ID based on the customer's state,
// and sends a POST request to the Vapi API.
query trigger_vapi_warranty_call verb=POST {
  api_group = "jobs"

  input {
    // The ID of the job to trigger the call for.
    int job_id {
      table = "jobs"
    }
  }

  stack {
    // 0. Ensure required environment variables are present
    precondition ($env.VAPI_PRIVATE_KEY != null) {
      error = "VAPI_PRIVATE_KEY is missing from environment variables."
    }
  
    precondition ($env.VAPI_ASSISTANT_ID != null) {
      error = "VAPI_ASSISTANT_ID is missing from environment variables."
    }
  
    // 1. Get the job record from the jobs table using job_id
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }
  
    // 2. Get the customer record linked to that job
    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer
  
    precondition ($customer != null) {
      error_type = "notfound"
      error = "Customer not found"
    }
  
    // 3. Determine which Vapi phone number to use based on the customer's state
    var $phone_id {
      value = $env.VAPI_PHONE_ID_TN
    }
  
    conditional {
      if ($customer.state == "LA") {
        var.update $phone_id {
          value = $env.VAPI_PHONE_ID_LA
        }
      }
    }
  
    // 3.5 Format the phone number to E.164 (+1...)
    var $formatted_phone {
      value = $customer.phone|trim
    }
  
    conditional {
      if (($formatted_phone|starts_with:"+") == false) {
        // Clean non-digits
        var.update $formatted_phone {
          value = $formatted_phone
            |replace:"-":""
            |replace:".":""
            |replace:" ":""
            |replace:"(":""
            |replace:")":""
        }
      
        conditional {
          if (($formatted_phone|starts_with:"1") && (($formatted_phone|strlen) == 11)) {
            var.update $formatted_phone {
              value = "+" ~ $formatted_phone
            }
          }
        
          else {
            var.update $formatted_phone {
              value = "+1" ~ $formatted_phone
            }
          }
        }
      }
    }
  
    // 4. Prepare the request body for Vapi
    var $vapi_body {
      value = {
        assistantId       : $env.VAPI_ASSISTANT_ID
        phoneNumberId     : $phone_id
        customer          : {
          number: $formatted_phone,
          name: ($customer.first_name ~ " " ~ $customer.last_name)
        }
        assistantOverrides: {
          variableValues: {
            customer_name: $customer.first_name,
            job_id: ($input.job_id|to_text),
            warranty_provider: $job.warranty_company,
            appliance_type: $job.appliance_type,
            service_address: ($customer.address ~ ", " ~ $customer.city ~ ", " ~ $customer.state ~ " " ~ $customer.zip)
          }
        }
      }
    }
  
    // 4.5 Make a POST request to https://api.vapi.ai/call
    api.request {
      url = "https://api.vapi.ai/call"
      method = "POST"
      params = $vapi_body
      headers = [
        "Authorization: Bearer " ~ $env.VAPI_PRIVATE_KEY
        "Content-Type: application/json"
      ]
    } as $vapi_result
  
    // 5. Check if the API request was successful
    precondition ($vapi_result.response.status >= 200 && $vapi_result.response.status < 300) {
      error = "Vapi API request failed with status " ~ ($vapi_result.response.status|to_text) ~ ": " ~ ($vapi_result.response.result|json_encode)
    }
  
    // 6. Update the jobs table for this job_id
    db.patch jobs {
      field_name = "id"
      field_value = $input.job_id
      data = {
        vapi_call_id    : $vapi_result.response.result.id
        vapi_call_status: "initiated"
        vapi_called_at  : now
        triage_status   : "vapi_called"
      }
    } as $updated_job
  }

  response = {
    vapi_request_body: $vapi_body
    vapi_response    : $vapi_result.response.result
    job              : $updated_job
  }

  guid = "jwIXp1VEnceyNx3heWdLjXowgyc"
}