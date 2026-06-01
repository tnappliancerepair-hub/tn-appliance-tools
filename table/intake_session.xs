table intake_session {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Unique session identifier shared between agents.
    text session_id? filters=trim
  
    // Reference to the customer record.
    int customer_id? {
      table = "customer"
    }
  
    // Customer's first name provided during intake.
    text first_name? filters=trim
  
    // Customer's last name provided during intake.
    text last_name? filters=trim
  
    // Customer's phone number provided during intake.
    text phone? filters=trim
  
    // Customer's email address provided during intake.
    text email? filters=trim
  
    // Customer's address provided during intake.
    text address? filters=trim
  
    // Customer's city provided during intake.
    text city? filters=trim
  
    // Customer's state provided during intake.
    text state? filters=trim
  
    // Customer's postal code provided during intake.
    text zip? filters=trim
  
    // Type of appliance reported by the customer.
    text appliance_type? filters=trim
  
    // Brand of the appliance reported by the customer.
    text brand? filters=trim
  
    // Model number of the appliance reported by the customer.
    text model_number? filters=trim
  
    // Summary of the appliance problem.
    text problem_summary? filters=trim
  
    // Recommended service type (e.g., 'quick_check', 'premium_video', 'truck_roll').
    text recommended_service? filters=trim
  
    // Customer's selected time window for service.
    text selected_time_window? filters=trim
  
    // Current step in the intake workflow (e.g., 'intake_started', 'model_collected').
    text current_step? filters=trim
  
    // Status of the handoff process (e.g., 'collecting_info', 'ready_for_ant', 'scheduled').
    text handoff_status? filters=trim
  
    // The agent or system that initiated or handled the intake.
    text source_agent? filters=trim
  
    // Timestamp of the last update to the session record.
    timestamp updated_at?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "XU9G_KZlt7ixoGpJOQtxWEPAP1c"
}