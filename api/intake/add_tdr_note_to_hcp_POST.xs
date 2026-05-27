// Adds a Technician Decision Report note to a Housecall Pro job
query add_tdr_note_to_hcp verb=POST {
  api_group = "intake"

  input {
    // Technician first name
    text technician_first_name?
  
    // Technician last name
    text technician_last_name?
  
    // Confidence level
    text confidence_level?
  
    // Verified part number
    text verified_part_number?
  
    // Estimated repair cost range
    text estimated_repair_cost_range?
  
    // Final recommendation
    text final_recommendation?
  
    text job_id? filters=trim
  }

  stack {
    // Construct the formatted note string
    var $formatted_note {
      value = """
        Technician Decision Report
        Technician: %s %s
        Confidence Level: %s
        Verified Part Number: %s
        Estimated Cost: %s
        Recommendation: %s
        """
        |sprintf:$input.technician_first_name:$input.technician_last_name:$input.confidence_level:$input.verified_part_number:$input.estimated_repair_cost_range:$input.final_recommendation
    }

    // HCP cutover kill-switch — when env.HCP_PUSH_DISABLED=true the call is skipped
    var $hcp_disabled {
      value = (($env.HCP_PUSH_DISABLED ?? "")|lower == "true")
    }

    var $hcp_response {
      value = {skipped: true, reason: "HCP_PUSH_DISABLED", status: 200}
    }

    conditional {
      if (!$hcp_disabled) {
        api.request {
          url = $env.HCP_BASE_URL ~ "/jobs/" ~ $input.job_id ~ "/notes"
          method = "POST"
          params = {content: $formatted_note}
          headers = []
            |push:"Authorization: Token " ~ $env.HCP_API_KEY
            |push:"Content-Type: application/json"
            |push:"Accept: application/json"
        } as $live_response
        var.update $hcp_response {
          value = $live_response
        }
      }
    }
  }

  response = $hcp_response
  guid = "3ec-lt7NITPWcs8Riw03EpzWwt4"
}