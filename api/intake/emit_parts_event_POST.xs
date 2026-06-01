// Single entry point that fires customer-facing SMS about a parts event.
// Called from Teddy Tool, office UI, or — eventually — Marcone/Triple S
// API webhooks. Status determines the SMS body.
//
// Status values:
//   "ordered"   → "We just ordered the parts for your {appliance}. ETA {date}."
//   "shipped"   → "Parts shipped! Tracking: {url}. ETA {date}."
//   "arrived"   → "Parts arrived at your home. {tech} comes {date}."
//   "delayed"   → "Heads up — parts delayed to {new_eta_date}. We'll adjust."
//
// Gated by send_sms (CUSTOMER_FACING_ENABLED). Writes event_log audit.
query emit_parts_event verb=POST {
  api_group = "intake"

  input {
    int job_id
    text status
    text? eta_date?
    text? tracking_url?
    text? new_eta_date?
    text? note?
    text? parts_link?
    bool? vendor_confirmed?
  }

  stack {
    var $status_trim {
      value = (($input.status ?? "")|trim)
    }

    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    precondition ($status_trim != "") {
      error_type = "inputerror"
      error = "status required"
    }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "Job not found"
    }

    var $cust_id {
      value = ($job.customer_id ?? 0)
    }

    var $cust {
      value = null
    }

    conditional {
      if ($cust_id > 0) {
        db.get customer {
          field_name = "id"
          field_value = $cust_id
        } as $cust_lookup

        var.update $cust {
          value = $cust_lookup
        }
      }
    }

    var $cust_first {
      value = (($cust.first_name ?? "")|trim)
    }

    var $cust_first_disp {
      value = ($cust_first != "") ? $cust_first : "there"
    }

    var $cust_phone {
      value = (($cust.phone ?? "")|trim)
    }

    var $appliance_word {
      value = (($job.appliance_type ?? "")|trim)
    }

    var $appliance_disp {
      value = ($appliance_word != "") ? $appliance_word : "appliance"
    }

    var $tech_first {
      value = ""
    }

    conditional {
      if (($job.technician_id ?? 0) > 0) {
        db.get technicians {
          field_name = "id"
          field_value = $job.technician_id
        } as $tech_row

        var.update $tech_first {
          value = (($tech_row.first_name ?? "")|trim|to_lower)
        }
      }
    }

    var $tech_disp {
      value = ($tech_first != "") ? $tech_first : "your tech"
    }

    var $eta_clean {
      value = (($input.eta_date ?? "")|trim)
    }

    var $eta_phrase {
      value = ($eta_clean != "") ? (" ETA " ~ $eta_clean ~ ".") : "."
    }

    var $track_clean {
      value = (($input.tracking_url ?? "")|trim)
    }

    var $track_phrase {
      value = ($track_clean != "") ? (" Tracking: " ~ $track_clean) : ""
    }

    var $new_eta_clean {
      value = (($input.new_eta_date ?? "")|trim)
    }

    var $note_clean {
      value = (($input.note ?? "")|trim)
    }

    var $status_lower {
      value = ($input.status|trim|to_lower)
    }

    var $sms_body_ordered {
      value = "Hi " ~ $cust_first_disp ~ " - we just ordered the parts for your " ~ $appliance_disp ~ " repair." ~ $eta_phrase ~ " We'll text you when they ship."
    }

    var $sms_body_shipped {
      value = "Hi " ~ $cust_first_disp ~ " - parts have shipped for your " ~ $appliance_disp ~ " repair!" ~ $track_phrase ~ $eta_phrase
    }

    var $arrival_day {
      value = ($eta_clean != "") ? $eta_clean : "the scheduled date"
    }

    var $sms_body_arrived {
      value = "Hi " ~ $cust_first_disp ~ " - your parts arrived. " ~ $tech_disp ~ " will install them on " ~ $arrival_day ~ "."
    }

    var $delay_to {
      value = ($new_eta_clean != "") ? (" to " ~ $new_eta_clean) : ""
    }

    var $sms_body_delayed {
      value = "Hi " ~ $cust_first_disp ~ " - heads up, your parts are delayed" ~ $delay_to ~ ". We'll reach out to adjust the visit. Sorry for the wait."
    }

    var $sms_body {
      value = ""
    }

    conditional {
      if ($status_lower == "ordered") {
        var.update $sms_body { value = $sms_body_ordered }
      }

      else {
        conditional {
          if ($status_lower == "shipped") {
            var.update $sms_body { value = $sms_body_shipped }
          }

          else {
            conditional {
              if ($status_lower == "arrived") {
                var.update $sms_body { value = $sms_body_arrived }
              }

              else {
                conditional {
                  if ($status_lower == "delayed") {
                    var.update $sms_body { value = $sms_body_delayed }
                  }
                }
              }
            }
          }
        }
      }
    }

    var $sms_sent {
      value = false
    }

    conditional {
      if ($cust_phone != "" && $sms_body != "") {
        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {to: $cust_phone, message: $sms_body, context_tag: ("parts_event_" ~ $status_lower)}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $sms_resp

        var.update $sms_sent {
          value = true
        }
      }
    }

    db.add event_log {
      data = {
        action  : ("parts_event_" ~ $status_lower)
        metadata: {
        job_id      : $input.job_id
        status      : $status_lower
        eta_date    : $eta_clean
        new_eta_date: $new_eta_clean
        tracking_url: $track_clean
        parts_link  : (($input.parts_link ?? "")|trim)
        note        : $note_clean
        sms_attempted: $sms_sent
      }
      }
    } as $audit

    // For status=ordered without a vendor confirmation, alert the
    // office that this part still needs to be MANUALLY ordered. Until
    // Marcone / Triple S APIs land, every 'ordered' tap surfaces a
    // manual-placement task. Customer SMS already went out promising
    // the order — office has to make it real.
    var $vendor_confirmed_flag {
      value = ($input.vendor_confirmed ?? false)
    }

    var $parts_link_clean {
      value = (($input.parts_link ?? "")|trim)
    }

    conditional {
      if ($status_lower == "ordered" && !$vendor_confirmed_flag) {
        var $office_link_phrase {
          value = ($parts_link_clean != "") ? ("\nLink: " ~ $parts_link_clean) : ""
        }

        var $office_note_phrase {
          value = ($note_clean != "") ? ("\nNote: " ~ $note_clean) : ""
        }

        var $office_body {
          value = "[ant] manual parts order needed - job #" ~ ($input.job_id|to_text) ~ $office_link_phrase ~ $office_note_phrase ~ "\nCustomer has been told parts are on the way - please place the order."
        }

        api.request {
          url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method = "POST"
          params = {to: "+16154850713", message: $office_body, context_tag: "manual_parts_order_needed"}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $office_alert
      }
    }
  }

  response = {
    success     : true
    job_id      : $input.job_id
    status      : $status_lower
    sms_attempted: $sms_sent
  }

  guid = "emit-parts-event-v1"
}
