// This endpoint triggers an inbound call test via the Vapi AI service.
// It formats the provided phone number to E.164 and sends a request to Vapi.
// Return the result from the Vapi API response
// Triggers a Vapi inbound test call
query trigger_vapi_inbound_test verb=POST {
  api_group = "intake"

  input {
    // The phone number to receive the call
    // Phone number to call
    text phone_number filters=trim
  }

  stack {
    // Strip all non-digit characters from the input phone number
    var $digits {
      value = "/\\D/"
        |regex_replace:"":$input.phone_number
    }
  
    // Ensure the number is in E.164 format by prepending a '+'
    var $formatted_number {
      value = "+" ~ $digits
    }
  
    // Construct the payload for the Vapi API request
    var $payload {
      value = {
        assistantId  : $env.VAPI_INBOUND_ASSISTANT_ID
        phoneNumberId: $env.VAPI_PHONE_ID_TN
        customer     : {
          number: $formatted_number,
          name: "Test Customer"
        }
      }
    }
  
    // Execute the POST request to the Vapi 'call' endpoint
    api.request {
      url = "https://api.vapi.ai/call"
      method = "POST"
      params = $payload
      headers = [
        "Authorization: Bearer " ~ ($env.VAPI_PRIVATE_KEY|to_text)
        "Content-Type: application/json"
      ]
    } as $api_result
  }

  response = $api_result.response.result
  guid = "cI_PZakS2VCIMQQkxgzBexrANDs"
}