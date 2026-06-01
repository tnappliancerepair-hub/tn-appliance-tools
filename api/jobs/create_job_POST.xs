// Creates a new service job and assigns default statuses.
query create_job verb=POST {
  api_group = "jobs"

  input {
    // Identifier for the associated customer.
    int customer_id
  
    // The type of appliance being serviced.
    text appliance_type? filters=trim
  
    // A brief summary of the appliance problem.
    text problem_summary? filters=trim
  
    // The brand of the appliance.
    text brand? filters=trim
  
    // The model number of the appliance.
    text model_number? filters=trim
  
    // The serial number of the appliance.
    text serial_number? filters=trim
  
    // Categorizes the customer's payment responsibility.
    text customer_type? filters=trim
  
    // Indicates the origin of the job.
    text source_type? filters=trim
  
    // The agent or system responsible for the job's intake.
    text source_agent? filters=trim
  
    // The name of the warranty company, if applicable.
    text warranty_company? filters=trim
  
    // The claim number associated with a warranty job.
    text claim_number? filters=trim
  
    // First preferred availability slot provided by the customer.
    text availability_one? filters=trim
  
    // Second preferred availability slot provided by the customer.
    text availability_two? filters=trim
  
    // Third preferred availability slot provided by the customer.
    text availability_three? filters=trim
  
    // URL to a photo of the appliance.
    text photo_appliance_url? filters=trim
  
    // URL to a video demonstrating the issue.
    text issue_video_url? filters=trim
  
    // Internal notes for team members.
    text notes_internal? filters=trim
  
    // Specific preferences mentioned by the customer.
    text customer_preference_text? filters=trim
  
    // The type of scheduling required for the job.
    text scheduling_type? filters=trim
  
    // Whether the customer has consented to SMS communication.
    bool sms_consent?
  
    // The timestamp when SMS consent was granted.
    timestamp? sms_consent_at?
  }

  stack {
    // Insert the new job record
    db.add jobs {
      data = {
        customer_id             : $input.customer_id
        job_number              : null
        problem_summary         : $input.problem_summary
        appliance_type          : $input.appliance_type
        brand                   : $input.brand
        model_number            : $input.model_number
        payment_status          : "unpaid"
        source_type             : $input.source_type
        source_agent            : $input.source_agent
        customer_type           : $input.customer_type
        warranty_company        : $input.warranty_company
        claim_number            : $input.claim_number
        serial_number           : $input.serial_number
        availability_one        : $input.availability_one
        availability_two        : $input.availability_two
        availability_three      : $input.availability_three
        photo_appliance_url     : $input.photo_appliance_url
        issue_video_url         : $input.issue_video_url
        payment_collected       : false
        job_status              : "submitted"
        triage_status           : "not_reviewed"
        parts_status            : "not_needed"
        scheduling_status       : "not_ready"
        notes_internal          : $input.notes_internal
        customer_preference_text: $input.customer_preference_text
        scheduling_type         : $input.scheduling_type
        sms_consent             : $input.sms_consent
        sms_consent_at          : $input.sms_consent_at
      }
    } as $new_job
  }

  response = $new_job
  guid = "6MNvocThrCcIBC6ifxkf7RpFiHs"
}