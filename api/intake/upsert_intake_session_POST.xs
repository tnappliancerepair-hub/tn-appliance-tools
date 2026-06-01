// Creates or updates an intake session based on the provided session_id.
query upsert_intake_session verb=POST {
  api_group = "intake"

  input {
    // Unique session identifier shared between agents
    text session_id
  
    // Reference to the customer record
    int customer_id?
  
    // Customer's first name
    text first_name?
  
    // Customer's last name
    text last_name?
  
    // Customer's phone number
    text phone?
  
    // Customer's email address
    text email?
  
    // Customer's address
    text address?
  
    // Customer's city
    text city?
  
    // Customer's state
    text state?
  
    // Customer's postal code
    text zip?
  
    // Type of appliance reported
    text appliance_type?
  
    // Brand of the appliance
    text brand?
  
    // Model number of the appliance
    text model_number?
  
    // Summary of the appliance problem
    text problem_summary?
  
    // Recommended service type
    text recommended_service?
  
    // Customer's selected time window
    text selected_time_window?
  
    // Current step in the intake workflow
    text current_step?
  
    // Status of the handoff process
    text handoff_status?
  }

  stack {
    // Query the intake_session table using session_id
    db.get intake_session {
      field_name = "session_id"
      field_value = $input.session_id
    } as $intake_session
  
    conditional {
      if ($intake_session == null) {
        // Create a new record if none was found
        db.add intake_session {
          data = {
            session_id          : $input.session_id
            customer_id         : $input.customer_id
            first_name          : $input.first_name
            last_name           : $input.last_name
            phone               : $input.phone
            email               : $input.email
            address             : $input.address
            city                : $input.city
            state               : $input.state
            zip                 : $input.zip
            appliance_type      : $input.appliance_type
            brand               : $input.brand
            model_number        : $input.model_number
            problem_summary     : $input.problem_summary
            recommended_service : $input.recommended_service
            selected_time_window: $input.selected_time_window
            current_step        : $input.current_step
            handoff_status      : $input.handoff_status
            source_agent        : "jimmy"
            updated_at          : "now"
          }
        } as $final_session
      }
    
      else {
        // Update the existing record using its id
        db.edit intake_session {
          field_name = "id"
          field_value = $intake_session.id
          data = {
            customer_id         : $input.customer_id
            first_name          : $input.first_name
            last_name           : $input.last_name
            phone               : $input.phone
            email               : $input.email
            address             : $input.address
            city                : $input.city
            state               : $input.state
            zip                 : $input.zip
            appliance_type      : $input.appliance_type
            brand               : $input.brand
            model_number        : $input.model_number
            problem_summary     : $input.problem_summary
            recommended_service : $input.recommended_service
            selected_time_window: $input.selected_time_window
            current_step        : $input.current_step
            handoff_status      : $input.handoff_status
            updated_at          : "now"
          }
        } as $final_session
      }
    }
  }

  response = $final_session
  guid = "B-7WB4le_AZqItV9RMwHEAyvS_M"
}