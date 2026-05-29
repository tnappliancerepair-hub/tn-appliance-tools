// Returns the customer's preferred comms channel based on observed
// behavior in the last 60 days.
//
// Signal weighting (positive = portal-preferring, negative = sms-preferring):
//   +3  portal_action_taken  (booked / approved / parts_arrived / answered)
//   +1  portal_viewed
//   +2  sms_reply             (responded to one of our texts)
//   -1  portal_link_unread    (we texted a portal link + 24h passed
//                              with no portal_viewed)
//
// Score interpretation:
//   score >= +3  → "portal"  (prefers portal; minimize SMS noise)
//   score <= -2  → "sms"     (won't use portal; put full info in text)
//   otherwise    → "unknown" (default = include both)
//
// Agents that send customer-direction comms should call this and shape
// the message:
//   portal: short SMS with portal link + portal carries the full action
//   sms:    full info + actionable detail INLINE in the SMS body
//   unknown: short SMS + portal link AND inline key info (current default)
query get_customer_channel_preference verb=GET {
  api_group = "intake"

  input {
    int customer_id
  }

  stack {
    precondition ($input.customer_id > 0) {
      error_type = "inputerror"
      error      = "customer_id required"
    }

    var $cutoff_ms {
      value = ((now|to_ms) - 5184000000)  // 60 days
    }

    var $cust_substr {
      value = "\"customer_id\":" ~ $input.customer_id
    }

    db.query event_log {
      filter {
        $this.action in ["portal_action_taken", "portal_viewed", "sms_reply_received", "portal_link_unread"]
        && $this.metadata contains $cust_substr
        && $this.created_at >= $cutoff_ms
      }
      sort = {created_at: "desc"}
    } as $rows

    var $portal_action_count { value = 0 }
    var $portal_view_count   { value = 0 }
    var $sms_reply_count     { value = 0 }
    var $portal_unread_count { value = 0 }

    foreach ($row in $rows.items) {
      conditional {
        if ($row.action == "portal_action_taken") {
          var $portal_action_count { value = ($portal_action_count + 1) }
        }
      }
      conditional {
        if ($row.action == "portal_viewed") {
          var $portal_view_count { value = ($portal_view_count + 1) }
        }
      }
      conditional {
        if ($row.action == "sms_reply_received") {
          var $sms_reply_count { value = ($sms_reply_count + 1) }
        }
      }
      conditional {
        if ($row.action == "portal_link_unread") {
          var $portal_unread_count { value = ($portal_unread_count + 1) }
        }
      }
    }

    var $score {
      value = (($portal_action_count * 3) + ($portal_view_count * 1) - ($sms_reply_count * 2) - ($portal_unread_count * 1))
    }

    var $prefers { value = "unknown" }
    conditional {
      if ($score >= 3) {
        var $prefers { value = "portal" }
      }
    }
    conditional {
      if ($score <= -2) {
        var $prefers { value = "sms" }
      }
    }
  }

  response = {
    customer_id        : $input.customer_id
    prefers            : $prefers
    score              : $score
    evidence: {
      portal_action_count : $portal_action_count
      portal_view_count   : $portal_view_count
      sms_reply_count     : $sms_reply_count
      portal_unread_count : $portal_unread_count
      window_days         : 60
    }
  }

  guid = "get-customer-channel-preference-v1"
}
