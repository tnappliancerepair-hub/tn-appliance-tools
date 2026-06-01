// Ensures a specific test customer exists and creates a test warranty job linked to them.
function create_test_job {
  input {
  }

  stack {
    // 1. Try to find the test customer by phone number.
    db.get customer {
      field_name = "phone"
      field_value = "+16154855795"
    } as $customer
  
    // 2. If the customer doesn't exist, create a new one with the provided details.
    conditional {
      if ($customer == null) {
        db.add customer {
          data = {
            first_name: "James"
            last_name : "Test"
            phone     : "+16154855795"
            state     : "TN"
            address   : "123 Test St"
            city      : "Nashville"
            zip       : "37215"
          }
        } as $customer
      }
    }
  
    // 3. Adds a new warranty job record linked to the specific test customer.
    db.add jobs {
      data = {
        customer_id     : $customer.id
        current_status  : "warranty_pending"
        triage_status   : "warranty_sent"
        warranty_company: "AHS"
        appliance_type  : "refrigerator"
        intake_source   : "jotform"
        created_at      : now|transform_timestamp:"-3 hours"
        vapi_called_at  : null
        waiver_signed   : false
      }
    } as $new_job
  }

  response = {customer_id: $customer.id, job_id: $new_job.id}
  guid = "sGG4VEXnKvE3Nqxfrox8dM7pens"
}