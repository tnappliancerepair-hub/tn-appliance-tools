// CSC tool — "have you contacted the customer / when was the last
// message / did the customer respond?" Returns chronological SMS +
// call events for the job. Scopes by job_id substring marker matched
// against event_log metadata.
//
// Covered actions: outbound SMS (sms_sent), inbound customer SMS
// (inbound_customer_sms_received), gated/dropped customer SMS
// (sms_gated, dropped_customer_sms), owner-bypass deliveries
// (sms_owner_bypass), feedback SMS, customer-direction SMS replies.
query get_customer_communications verb=POST {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id is required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    var $customer_id {
      value = ($job.customer_id ?? 0)
    }

    var $job_marker {
      value = "\"job_id\":" ~ ($input.job_id|to_text)
    }
    var $cust_marker {
      value = "\"customer_id\":" ~ ($customer_id|to_text)
    }

    db.query event_log {
      where = $db.event_log.action == "sms_sent" || $db.event_log.action == "inbound_customer_sms_received" || $db.event_log.action == "sms_gated" || $db.event_log.action == "dropped_customer_sms" || $db.event_log.action == "sms_owner_bypass" || $db.event_log.action == "feedback_sms_sent" || $db.event_log.action == "customer_sms_reply_sent" || $db.event_log.action == "inbound_call_received" || $db.event_log.action == "outbound_call_completed" || $db.event_log.action == "vapi_call_completed" || $db.event_log.action == "vapi_voicemail_received"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $event_rows

    var $messages {
      value = []
    }

    foreach ($event_rows.items) {
      each as $r {
        var $meta_obj {
          value = ($r.metadata ?? {})
        }
        var $meta_str {
          value = $meta_obj|json_encode
        }
        var $stripped1 {
          value = $meta_str|replace:$job_marker:""
        }
        var $stripped2 {
          value = $meta_str|replace:$cust_marker:""
        }
        var $job_hit {
          value = (($stripped1|strlen) < ($meta_str|strlen))
        }
        var $cust_hit {
          value = ($customer_id > 0 && ($stripped2|strlen) < ($meta_str|strlen))
        }

        conditional {
          if ($job_hit == true || $cust_hit == true) {
            var $matched_by {
              value = "customer_id"
            }
            conditional {
              if ($job_hit == true) {
                var.update $matched_by {
                  value = "job_id"
                }
              }
            }
            var $entry {
              value = {
                id        : ($r.id ?? 0)
                action    : ($r.action ?? "")
                created_at: ($r.created_at ?? 0)
                metadata  : ($r.metadata ?? {})
                matched_by: $matched_by
              }
            }
            var.update $messages {
              value = $messages|push:$entry
            }
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "csc_tool_get_customer_communications"
        metadata: ({job_id: $input.job_id, customer_id: $customer_id, count: ($messages|count)}|json_encode)
      }
    }
  }

  response = {
    success    : true
    job_id     : $input.job_id
    customer_id: $customer_id
    count      : ($messages|count)
    messages   : $messages
  }

  guid = "get-customer-communications-v1"
}
