//  Daily 9am CT cron. Finds jobs whose ordered parts have arrived (per
//  parts_eta_date) and have not yet been told the customer, sends them the
//  "your part has arrived, ready to schedule?" SMS, and burns the
//  parts_customer_notified flag so we never re-fire.
// 
//  Gate: PARTS_ARRIVAL_NOTIFY_ENABLED env var. Anything other than "true"
//  short-circuits before any reads or writes.
task parts_arrival_notify {
  stack {
    conditional {
      if ($env.PARTS_ARRIVAL_NOTIFY_ENABLED != "true") {
        debug.log {
          value = "parts_arrival_notify skipped: PARTS_ARRIVAL_NOTIFY_ENABLED != 'true'"
        }
      
        return {
          value = null
        }
      }
    }
  
    var $today_ct_ts {
      value = now|transform_timestamp:"-5 hours"
    }
  
    var $today_ct_date {
      value = $today_ct_ts|format_timestamp:"Y-m-d"
    }
  
    db.query jobs {
      where = $db.jobs.parts_status == "ordered" && $db.jobs.parts_customer_notified == false && $db.jobs.parts_eta_date != null && $db.jobs.parts_eta_date <= $today_ct_date
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $ready_jobs
  
    var $notified_count {
      value = 0
    }
  
    foreach ($ready_jobs.items) {
      each as $rj {
        db.get customer {
          field_name = "id"
          field_value = $rj.customer_id
        } as $cust
      
        var $cust_phone_trimmed {
          value = ($cust != null) ? (($cust.phone ?? "")|trim) : ""
        }
      
        conditional {
          if ($cust != null && $cust_phone_trimmed != "") {
            var $cust_first {
              value = (($cust.first_name ?? "")|trim)
            }
          
            conditional {
              if ($cust_first == "") {
                var.update $cust_first {
                  value = "there"
                }
              }
            }
          
            var $appl_pa {
              value = (($rj.appliance_type ?? "")|trim)
            }
          
            var $arrival_body {
              value = "Hi " ~ $cust_first ~ ", great news - your part has arrived! Ready to schedule your " ~ $appl_pa ~ " repair? Reply with a few days and times that work for you and we will get you on the calendar."
            }
          
            var $gate_pa_recipient_bare {
              value = $cust_phone_trimmed
            }
          
            var $gate_pa_is_owner {
              value = ($gate_pa_recipient_bare == "6154855795") || ($gate_pa_recipient_bare == "+16154855795")
            }
          
            var $gate_pa_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate_pa_should_send {
              value = $gate_pa_sms_enabled || $gate_pa_is_owner
            }
          
            conditional {
              if ($gate_pa_should_send) {
                api.request {
                  url = "https://api.telnyx.com/v2/messages"
                  method = "POST"
                  params = {
                    from: $env.TELNYX_FROM_TECH
                    to  : "+1" ~ $cust_phone_trimmed
                    text: $arrival_body
                  }
                
                  headers = [
                    "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                    "Content-Type: application/json"
                  ]
                } as $arrival_sms
              
                db.edit jobs {
                  field_name = "id"
                  field_value = $rj.id
                  data = {parts_customer_notified: true}
                } as $marked
              
                db.add event_log {
                  data = {
                    action  : "parts_arrival_sms_sent"
                    metadata: {
                    job_id     : $rj.id
                    customer_id: $cust.id
                    phone      : $cust_phone_trimmed
                    eta_date   : $rj.parts_eta_date
                  }
                  }
                } as $pa_log
              
                var.update $notified_count {
                  value = $notified_count + 1
                }
              }
            }
          }
        }
      }
    }
  
    debug.log {
      value = "parts_arrival_notify: notified " ~ ($notified_count|to_text) ~ " customers"
    }
  }

  schedule = [{starts_on: 2026-05-22 14:00:00+0000, freq: 86400}]
  guid = "pSuE2JtJ8Kjpt8it0b8Ld9x-zj8"
}