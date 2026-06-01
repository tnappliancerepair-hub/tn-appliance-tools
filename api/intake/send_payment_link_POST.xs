// Determine payment link and message, then send via SMS
query send_payment_link verb=POST {
  api_group = "intake"

  input {
    text phone_number
    int amount
  }

  stack {
    var $link {
      value = ""
    }
  
    var $message {
      value = ""
    }
  
    conditional {
      if ($input.amount == 50) {
        var.update $link {
          value = $env.STRIPE_LINK_50
        }
      
        var.update $message {
          value = "Hi! Here's your secure payment link for the $50 TN Appliance Exchange Quick Check: " ~ $link ~ ". Once complete you'll receive instructions for submitting your appliance photos and video. Questions? Reply here or chat at tnapplianceexchange.net"
        }
      }
    
      elseif ($input.amount == 90) {
        var.update $link {
          value = $env.STRIPE_LINK_90
        }
      
        var.update $message {
          value = "Hi! Here's your secure payment link for the $90 TN Appliance Exchange Video Diagnostic: " ~ $link ~ ". Once complete we'll confirm your video call time. Your in-home visit is free after this step."
        }
      }
    
      elseif ($input.amount == 100) {
        var.update $link {
          value = $env.STRIPE_LINK_100
        }
      
        var.update $message {
          value = "Hi! Here's your secure payment link for the $100 TN Appliance Exchange trip fee: " ~ $link ~ ". Once complete we'll confirm your appointment. This amount applies toward your repair if the estimate is accepted."
        }
      }
    
      else {
        throw {
          name = "InvalidAmount"
          value = "Invalid amount. Supported amounts: 50, 90, 100."
        }
      }
    }
  
    // Call the send_sms endpoint directly (#32)
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {to: $input.phone_number, message: $message}
      headers = ["Content-Type: application/json"]
    } as $sms_response
  }

  response = {
    success   : true
    message   : "Payment link sent"
    sms_status: $sms_response.status
  }

  guid = "-cWNSHeeWCU2_WG9zh5vTZjwBkk"
}