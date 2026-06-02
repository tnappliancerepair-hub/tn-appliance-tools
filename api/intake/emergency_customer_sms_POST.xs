// Emergency customer SMS — calls Telnyx DIRECTLY, bypassing the
// CUSTOMER_FACING_ENABLED gate. Used for inbound-call-webhook auto-ack
// so a customer ALWAYS hears back when they reach us, even if the
// global customer-facing gate is off.
//
// Hard dedup: max 1 send per phone per 6 hours via event_log scan.
// Audit log row written on every call.
//
// REQUIRED env: TELNYX_API_KEY, TELNYX_PROFILE_ID, TELNYX_FROM_CUSTOMER
//
// This is a NARROW-PURPOSE endpoint. Do not extend it into a generic
// gate-bypass. Use send_sms with proper context_tag for everything else.
query emergency_customer_sms verb=POST {
  api_group = "intake"

  input {
    text phone
    text body
    text? source?
  }

  stack {
    precondition ($input.phone != "" && $input.body != "") {
      error_type = "inputerror"
      error      = "phone and body required"
    }

    var $digits {
      value = "/[^0-9]/"|regex_replace:"":$input.phone
    }

    var $clean_phone {
      value = ""
    }

    conditional {
      if (($digits|strlen) == 10) {
        var.update $clean_phone { value = "+1" ~ $digits }
      }
      elseif ((($digits|strlen) == 11) && ($digits|starts_with:"1")) {
        var.update $clean_phone { value = "+" ~ $digits }
      }
      else {
        var.update $clean_phone { value = "+" ~ $digits }
      }
    }

    // Dedup — last 6 hours
    var $dedup_since_ms {
      value = (now|to_ms) - 21600000
    }

    db.query event_log {
      where = $db.event_log.action == "emergency_customer_sms_sent" && $db.event_log.created_at >= $dedup_since_ms
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $recent

    var $already_sent {
      value = false
    }

    foreach ($recent.items) {
      each as $row {
        conditional {
          if (! $already_sent) {
            var $meta_text {
              value = (($row.metadata ?? "")|to_text)
            }
            conditional {
              if ($meta_text|contains:$clean_phone) {
                var.update $already_sent { value = true }
              }
            }
          }
        }
      }
    }

    conditional {
      if ($already_sent) {
        return {
          value = {
            success      : true
            skipped      : true
            reason       : "dedup_6h"
            phone        : $clean_phone
          }
        }
      }
    }

    // Direct Telnyx call (bypass send_sms gate)
    var $auth_header {
      value = "Bearer " ~ $env.TELNYX_API_KEY
    }

    api.request {
      url = "https://api.telnyx.com/v2/messages"
      method = "POST"
      params = {
        from                : $env.TELNYX_FROM_CUSTOMER
        to                  : $clean_phone
        text                : $input.body
        messaging_profile_id: $env.TELNYX_PROFILE_ID
      }
      headers = [
        "Content-Type: application/json"
        "Authorization: " ~ $auth_header
      ]
    } as $tx

    var $tx_http {
      value = ($tx.response.status ?? 0)
    }

    var $tx_msg_id {
      value = (($tx.response.result.data.id ?? "")|to_text)
    }

    var $tx_status {
      value = (($tx.response.result.data.to[0].status ?? "")|to_text)
    }

    var $is_ok {
      value = ($tx_http >= 200 && $tx_http < 300)
    }

    db.add event_log {
      data = {
        action  : "emergency_customer_sms_sent"
        metadata: ```
          {
            phone        : $clean_phone
            source       : (($input.source ?? "unspecified")|to_text)
            body_len     : ($input.body|strlen)
            telnyx_http  : $tx_http
            telnyx_msg_id: $tx_msg_id
            telnyx_status: $tx_status
            success      : $is_ok
          }|json_encode
        ```
      }
    }
  }

  response = {
    success       : $is_ok
    phone         : $clean_phone
    telnyx_http   : $tx_http
    telnyx_msg_id : $tx_msg_id
    telnyx_status : $tx_status
  }

  guid = "emergency-customer-sms-v1"
}
