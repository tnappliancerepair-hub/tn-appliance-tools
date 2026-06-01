// Tech Ant brain - handles technician interaction for TDR data collection.
// AI assistant for technicians at job sites to complete TDR data collection
query tech_ant_reply verb=POST {
  api_group = "intake"

  input {
    // Unique ID for this tech ant conversation
    text session_id
  
    // The job being worked on
    int job_id {
      table = "jobs"
    }
  
    // Which tech is using Tech Ant
    int tech_id {
      table = "technicians"
    }
  
    // What the tech just said or typed
    text user_message
  
    // Previous messages in the format [{"role":"user","content":"..."},{"role":"assistant","content":"..."}]
    json? conversation_history?
  
    // Any attachment IDs the tech just uploaded
    json? attachment_ids?
  }

  stack {
    // 1. Validate inputs
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job
  
    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }
  
    db.get technicians {
      field_name = "id"
      field_value = $input.tech_id
    } as $tech
  
    precondition ($tech != null) {
      error_type = "notfound"
      error = "Technician not found"
    }
  
    // 2. Fetch related data
    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer
  
    db.query job_attachments {
      where = $db.job_attachments.job_id == $job.id
      return = {type: "list"}
    } as $attachments
  
    var $history {
      value = (($input.conversation_history|is_array) ? $input.conversation_history : [])
    }
  
    // 3. Update tech_ant_chat_started_at if first message
    conditional {
      if (($history|count) == 0) {
        db.edit jobs {
          field_name = "id"
          field_value = $job.id
          data = {tech_ant_chat_started_at: "now"}
        } as $updated_job
      }
    }
  
    // 4. Build system prompt
    var $customer_name {
      value = ($customer.first_name ?? "") ~ " " ~ ($customer.last_name ?? "")
    }
  
    var $tech_name {
      value = ($tech.first_name ?? "Tech")
    }
  
    var $brand {
      value = ($job.brand ?? "Unknown")
    }
  
    var $appliance_type {
      value = ($job.appliance_type ?? "Unknown")
    }
  
    var $model_number {
      value = ($job.model_number ?? "Not provided")
    }
  
    var $problem_summary {
      value = ($job.problem_summary ?? "Not provided")
    }
  
    var $attachments_json {
      value = $attachments|json_encode
    }
  
    var $raw_prompt {
      value = """
        You are Tech Ant, a no-nonsense, efficient colleague helping REPLACE_TECH_NAME complete the Technician Decision Report (TDR) for a job. Your goal is to collect all required data as quickly as possible so the tech can move to the next job. Be brief, direct, and helpful. Use voice and text equally well.
        
        JOB CONTEXT:
        - Customer: REPLACE_CUSTOMER_NAME
        - Appliance: REPLACE_BRAND REPLACE_APPLIANCE_TYPE
        - Model: REPLACE_MODEL_NUMBER
        - Problem Summary: REPLACE_PROBLEM_SUMMARY
        
        REQUIRED FIELDS TO COLLECT:
        1. model_number_verified (Requires photo of model tag uploaded)
        2. symptom (what is the problem)
        3. diagnostic_test_performed
        4. failed_component
        5. failure_cause (Must be one of: normal_wear, lack_of_maintenance, customer_misuse, pests, power_surge, manufacturer_defect, improper_installation, external_damage, pre_existing, other)
        6. failure_cause_notes (Required if cause is other or customer_misuse)
        7. verified_part_number (If tech doesn't know the number, ask for the part name and confirm model number is correct — flag as part_name_only so office can look it up)
        8. recommendation (One of: repair_authorized, customer_denied, replace_unit, customer_self_pay)
        9. repair_completed (Did you fully repair it today? yes / no / partial)
        10. repair_not_completed_reason (Required if repair_completed is no or partial)
        11. parts_used (array — each part used: [{part_number, description, quantity, status: "used"}])
        12. parts_not_used (array — each part NOT used that needs return: [{part_number, description, quantity, status: "return"}])
        13. labor_time_hours (how long the job took in hours — e.g. 1, 1.5, 2)
        14. second_visit_needed (yes or no)
        
        WARRANTY PARTS RULES:
        - Always ask about EVERY part ordered for this job
        - For each part ask: Did you use it, leave it with the customer, or does it need to be returned?
        - Status options: used / return / pending_second_repair / at_customer
        - This is critical for SquareTrade and AHS warranty submission — Danielle needs this exact info
        - If tech doesn't know the part number ask: "What's the part name?" and "Is the model number REPLACE_MODEL_NUMBER correct?" — flag it as needs_office_lookup in part_name_only_flags
        
        REQUIRED PHOTOS BY APPLIANCE TYPE:
        - refrigerator: model tag, fridge thermometer, freezer thermometer, failure photo
        - oven/range: model tag, oven temp probe at preheat, failure photo
        - dryer: model tag, drum temp at 5min, vent condition photo
        - washer: model tag, water level/leak photo, failure photo
        - dishwasher: model tag, water in tub running, failure photo
        - other: model tag, failure photo
        
        CURRENT ATTACHMENTS ON JOB:
        REPLACE_ATTACHMENTS_JSON
        
        CONVERSATION ORDER:
        1. Greet tech and confirm job details — customer, appliance, model number
        2. What part numbers are needed to fix this? 
           → If unknown: ask for part name and confirm model number is correct — flag as needs_office_lookup
        3. What is the symptom — what is the appliance doing or not doing?
        4. What failed and what caused it?
        5. What diagnostic test did you perform?
        6. Was the repair completed today? yes / no / partial
           → If no or partial: why not?
        7. Were any parts sent to this job?
           → If yes: which ones did you actually use? (part number and description)
           → Which ones are unused and need to be returned?
        8. How long did the job take in hours?
        9. Is a second visit needed?
        10. What is your recommendation?
        11. When ALL fields collected → READY_TO_SUBMIT
        
        SPEED RULES:
        - Ask multiple related questions in one message when possible
        - Do not repeat questions already answered
        - Do not ask for info already in the job record
        - Be direct and brief — techs are at a job site
        - Target under 5 minutes total
        - Never ask the same thing twice
        
        INSTRUCTIONS:
        - If tech can't find a part number say: "No problem — give me the part name and I'll flag it for the office to look up."
        - BLOCK submission until ALL required fields and photos are collected
        - When ALL data collected respond with READY_TO_SUBMIT at the end of your message
        - Return all captured data in a JSON block at the end: [DATA]{...}[/DATA]
        - parts_used and parts_not_used must always be arrays even if empty []
        - part_name_only_flags must be an array of any parts where number was unknown
        
        Your tone should be like a peer, not a chatbot. No corporate fluff. Let's get this done.
        """
    }
  
    var $system_prompt {
      value = $raw_prompt
        |replace:"REPLACE_TECH_NAME":$tech_name
        |replace:"REPLACE_CUSTOMER_NAME":$customer_name
        |replace:"REPLACE_BRAND":$brand
        |replace:"REPLACE_APPLIANCE_TYPE":$appliance_type
        |replace:"REPLACE_MODEL_NUMBER":$model_number
        |replace:"REPLACE_PROBLEM_SUMMARY":$problem_summary
        |replace:"REPLACE_ATTACHMENTS_JSON":$attachments_json
    }
  
    // 5. Call Claude API
    var $messages {
      value = ($history ?? [])
    }
  
    conditional {
      if (!($messages|is_array)) {
        var.update $messages {
          value = []
        }
      }
    }
  
    array.push $messages {
      value = {role: "user", content: $input.user_message}
    }
  
    api.request {
      url = "https://api.anthropic.com/v1/messages"
      method = "POST"
      params = {
        model     : "claude-sonnet-4-5-20250929"
        max_tokens: 1024
        system    : $system_prompt
        messages  : $messages
      }
    
      headers = [
        "x-api-key: " ~ $env.ANTHROPIC_API_KEY
        "anthropic-version: 2023-06-01"
        "content-type: application/json"
      ]
    
      timeout = 60
    } as $claude_response
  
    precondition ($claude_response.response.status == 200) {
      error = "Claude API Error: " ~ ($claude_response.response.result|json_encode)
    }
  
    var $reply_text {
      value = $claude_response.response.result.content[0].text
    }
  
    // 6. Handle agent conversation and messages
    db.query agent_conversation {
      where = $db.agent_conversation.session_id == $input.session_id
      return = {type: "single"}
    } as $conversation
  
    conditional {
      if ($conversation == null) {
        db.add agent_conversation {
          data = {
            session_id     : $input.session_id
            title          : "Tech Ant Session: " ~ $input.session_id
            last_message_at: "now"
            customer_id    : $job.customer_id
          }
        } as $conversation
      }
    
      else {
        db.edit agent_conversation {
          field_name = "id"
          field_value = $conversation.id
          data = {last_message_at: "now"}
        } as $conversation
      }
    }
  
    // Save user message
    db.add agent_message {
      data = {
        conversation_id: $conversation.id
        role           : "user"
        content        : $input.user_message
      }
    } as $saved_user_msg
  
    // Save assistant message
    db.add agent_message {
      data = {
        conversation_id: $conversation.id
        role           : "assistant"
        content        : $reply_text
      }
    } as $saved_assistant_msg
  
    // 7. Parse response for flags and data
    var $ready_to_submit {
      value = $reply_text|contains:"READY_TO_SUBMIT"
    }
  
    var $collected_data {
      value = null
    }
  
    conditional {
      if ($reply_text|contains:"[DATA]") {
        var $data_parts {
          value = $reply_text|split:"[DATA]"
        }
      
        var $data_content {
          value = $data_parts
            |get:1
            |split:"[/DATA]"
            |get:0
        }
      
        var.update $collected_data {
          value = $data_content|json_decode
        }
      }
    }
  
    // Clean reply text for frontend display
    var $display_reply {
      value = $reply_text
        |split:"[DATA]"
        |get:0
        |replace:"READY_TO_SUBMIT":""
        |trim
    }
  
    var $result {
      value = {
        success        : true
        reply          : $display_reply
        session_id     : $input.session_id
        ready_to_submit: $ready_to_submit
        collected_data : $collected_data
      }
    }
  }

  response = $result
  guid = "eBrwtvwz6Q4QR0sWL5e5iS8_1g0"
}