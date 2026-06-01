// Triggers an outbound Vapi call for parts followup for a specific job.
// Return success status and the generated Vapi call ID.
// Triggers an outbound Vapi call for parts followup.
function trigger_parts_followup {
  input {
    // ID of the job to trigger followup for.
    int job_id
  }

  stack {
    // 1. Look up the job by job_id to get customer, technician, and cluster information.
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    // Handle case where job is not found by returning early with an error.
    conditional {
      if ($job == null) {
        return {
          value = {error: "job not found"}
        }
      }
    }
  
    // 2. Look up the customer record associated with the job.
    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer
  
    // 3. Look up the technician record associated with the job.
    db.get technicians {
      field_name = "id"
      field_value = $job.technician_id
    } as $technician
  
    // 4. Determine the appropriate Vapi phone number ID based on the job's cluster (LA or TN).
    var $phone_number_id {
      value = $env.VAPI_PHONE_ID_LA
    }
  
    conditional {
      if ($job.cluster != null && ($job.cluster|to_upper|contains:"TN")) {
        var.update $phone_number_id {
          value = $env.VAPI_PHONE_ID_TN
        }
      }
    }
  
    // 5. Prepare the Vapi API request body with assistant ID, customer number, and context variables.
    var $vapi_body {
      value = {
        assistantId       : "b71260b4-c284-4657-99a4-03c9bb1a0624"
        phoneNumberId     : $phone_number_id
        customer          : {
          number: $customer.phone
        }
        assistantOverrides: {
          variableValues: {
            customer_name : $customer.first_name,
            job_id        : $input.job_id,
            appliance_type: $job.appliance_type,
            zip_code      : $customer.zip
          }
        }
      }
    }
  
    // 6. Execute the POST request to the Vapi API to initiate the call.
    api.request {
      url = "https://api.vapi.ai/call"
      method = "POST"
      params = $vapi_body
      headers = [
        "Authorization: Bearer " ~ $env.VAPI_PRIVATE_KEY
        "Content-Type: application/json"
      ]
    } as $vapi_response
  
    // 7. Extract the Vapi call ID from the response and update the job record.
    var $vapi_call_id {
      value = $vapi_response.response.result.id
    }
  
    db.patch jobs {
      field_name = "id"
      field_value = $job.id
      data = {
        parts_followup_called_at: now
        vapi_call_id            : $vapi_call_id
      }
    } as $updated_job
  }

  response = {success: true, vapi_call_id: $vapi_call_id}
  guid = "1cxtIReNUWVBNy_tdZm-yKUVY9E"
}