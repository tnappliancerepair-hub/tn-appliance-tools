// Issue a Call Control "transfer" command to redirect an inbound call
// to a different phone number. Used by the inbound-call-webhook.js
// Netlify function to forward calls on the vanity numbers (which are
// attached to a Telnyx Voice Application and thus can't use simple
// auto-forwarding).
//
// Usage:
//   POST /transfer_telnyx_call
//   body: { "call_control_id": "<id>", "to": "+16154855795" }
query transfer_telnyx_call verb=POST {
  api_group = "intake"

  input {
    text call_control_id
    text to
  }

  stack {
    var $ccid {
      value = (($input.call_control_id ?? "")|trim)
    }

    var $target {
      value = (($input.to ?? "")|trim)
    }

    conditional {
      if ($ccid == "" || $target == "") {
        return {
          value = {
            success: false
            error  : "missing_inputs"
          }
        }
      }
    }

    var $auth_header {
      value = "Bearer " ~ $env.TELNYX_API_KEY
    }

    api.request {
      url = "https://api.telnyx.com/v2/calls/" ~ $ccid ~ "/actions/transfer"
      method = "POST"
      headers = ["Authorization: " ~ $auth_header, "Content-Type: application/json"]
      params = {
        to: $target
      }
      timeout = 12
    } as $transfer_resp

    var $status_code {
      value = ($transfer_resp.response.status ?? 0)
    }

    db.add event_log {
      data = {
        action  : "telnyx_call_transferred"
        metadata: ({call_control_id:$ccid,target:$target,status:$status_code}|json_encode)
      }
    }
  }

  response = {
    success: true
    status : $status_code
    body   : ($transfer_resp.response.result ?? null)
  }

  guid = "transfer-telnyx-call-v1"
}
