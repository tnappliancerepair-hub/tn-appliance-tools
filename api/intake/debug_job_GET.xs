// Retrieves full job and customer records for verification of specific fields.
// Return both records for verification
// Retrieves full job and customer records for verification.
query debug_job verb=GET {
  api_group = "intake"

  input {
    // The ID of the job to retrieve
    int id
  }

  stack {
    // Retrieve the job record from the database
    db.get jobs {
      field_name = "id"
      field_value = $input.id
    } as $job
  
    // Initialize customer variable
    var $customer {
      value = null
    }
  
    // Retrieve the linked customer record if the job exists
    conditional {
      if ($job != null && $job.customer_id != null) {
        db.get customer {
          field_name = "id"
          field_value = $job.customer_id
        } as $customer
      }
    }
  }

  response = {job: $job, customer: $customer}
  guid = "0jlhN-8oPD3kwBBQ0ykm4pGnQ5c"
}