// Called by phone-ant-brain.js + vapi-webhook.js on every inbound call
// (and assistant-request from Vapi). Returns the caller's full context:
//   { found: bool, customer: {...}, open_jobs: [...], last_call_summary: text }
// so the LLM can greet by name + reference open jobs + recall last
// interaction. Without this endpoint Vapi treats every caller as unknown.
//
// Phone normalization mirrors get_job_by_phone.xs.
query lookup_customer_by_phone verb=GET {
  api_group = "intake"

  input {
    text phone
  }

  stack {
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

    // Compute 10-digit form (strip leading '1' if 11-digit). The customer AND
    // technicians tables store phones as bare 10-digit strings (e.g.
    // "6154855795"), so the lookup MUST include this form - otherwise a call
    // from an 11-digit / E.164 caller ID ("+16154855795") never matches a
    // stored customer. THIS was the "agent couldn't find them" bug: the
    // customer query omitted $ten_digits (only technicians had it).
    var $ten_digits {
      value = $digits
    }
    conditional {
      if (($digits|strlen) == 11 && ($digits|starts_with:"1")) {
        var.update $ten_digits {
          value = ($digits|substr:1:10)
        }
      }
    }

    db.query customer {
      where = $db.customer.phone == $clean_phone || $db.customer.phone == $input.phone || $db.customer.phone == $digits || $db.customer.phone == $ten_digits
      sort = {customer.id: "desc"}
      return = {type: "single"}
    } as $customer

    // ALWAYS also check the technicians table - owner (Teddy) + Jimmy,
    // Andre, Lee, Billy, John when they call from personal cells.
    // Recognize them so Ant addresses them as staff, even if a junk
    // customer record exists for the same number.
    db.query technicians {
      where = $db.technicians.phone == $clean_phone || $db.technicians.phone == $input.phone || $db.technicians.phone == $digits || $db.technicians.phone == $ten_digits
      sort = {technicians.id: "asc"}
      return = {type: "single"}
    } as $internal_tech

    var $is_internal { value = ($internal_tech != null) }
    var $internal_role { value = "" }
    conditional {
      if ($is_internal == true) {
        var $tid { value = ($internal_tech.id ?? 0) }
        var.update $internal_role { value = "technician" }
        conditional {
          if ($tid == 1) {
            var.update $internal_role { value = "owner" }
          }
        }
      }
    }

    conditional {
      if ($customer == null && $is_internal == false) {
        return {
          value = {
            found             : false
            is_internal       : false
            customer          : null
            open_jobs         : []
            last_call_summary : ""
          }
        }
      }
    }

    // Staff caller (no customer match) - return staff context.
    conditional {
      if ($customer == null && $is_internal == true) {
        return {
          value = {
            found             : true
            is_internal       : true
            internal_role     : $internal_role
            customer          : null
            technician        : $internal_tech
            open_jobs         : []
            last_call_summary : ""
          }
        }
      }
    }

    db.query jobs {
      where = $db.jobs.customer_id == $customer.id && $db.jobs.scheduling_status != "completed" && $db.jobs.scheduling_status != "canceled" && $db.jobs.scheduling_status != "no_fix_possible"
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 10}}
    } as $open_jobs_q

    var $open_jobs_out {
      value = []
    }

    foreach ($open_jobs_q.items) {
      each as $j {
        var $tech_first {
          value = ""
        }

        conditional {
          if ($j.technician_id != null && $j.technician_id > 0) {
            db.get technicians {
              field_name = "id"
              field_value = $j.technician_id
            } as $tech_row

            var.update $tech_first {
              value = (($tech_row.first_name ?? "")|trim)
            }
          }
        }

        var $scheduled_ct {
          value = ""
        }

        conditional {
          if ($j.scheduled_start != null && $j.scheduled_start > 0) {
            var.update $scheduled_ct {
              value = $j.scheduled_start|transform_timestamp:"-5 hours"|format_timestamp:"D M j, g:i A"
            }
          }
        }

        var $job_row {
          value = {
            id                  : $j.id
            appliance_type      : (($j.appliance_type ?? "")|trim)
            brand               : (($j.brand ?? "")|trim)
            scheduling_status   : (($j.scheduling_status ?? "")|trim)
            scheduled_start_ct  : $scheduled_ct
            tech_first_name     : $tech_first
            parts_status        : (($j.parts_status ?? "")|trim)
            parts_eta_date      : (($j.parts_eta_date ?? "")|trim)
            warranty_company    : (($j.warranty_company ?? "")|trim)
            problem_summary     : (($j.problem_summary ?? "")|trim)
          }
        }

        var.update $open_jobs_out {
          value = $open_jobs_out|push:$job_row
        }
      }
    }

    // last_call_summary - pre-call context engine. Pull the most
    // recent phone_call_summary event_log row matching this customer
    // by substring search on the metadata JSON. Ant uses this to
    // recall what we last talked about (compounds trust over time).
    var $cust_marker {
      value = "\"customer_id\":" ~ ($customer.id|to_text)
    }
    db.query event_log {
      where = $db.event_log.action == "phone_call_summary"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 30}}
    } as $call_rows
    var $last_call_text {
      value = ""
    }
    var $last_call_ms {
      value = 0
    }
    foreach ($call_rows.items) {
      each as $r {
        conditional {
          if ($last_call_text == "") {
            var $meta_str {
              value = ($r.metadata ?? {})|json_encode
            }
            var $stripped {
              value = $meta_str|replace:$cust_marker:""
            }
            conditional {
              if (($stripped|strlen) < ($meta_str|strlen)) {
                var $summary_obj {
                  value = $r.metadata
                }
                var.update $last_call_text {
                  value = (($summary_obj.summary ?? "")|to_text)|trim
                }
                var.update $last_call_ms {
                  value = ($r.created_at ?? 0)
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    found             : true
    is_internal       : $is_internal
    internal_role     : $internal_role
    customer          : $customer
    technician        : $internal_tech
    open_jobs         : $open_jobs_out
    last_call_summary : $last_call_text
    last_call_at_ms   : $last_call_ms
  }

  guid = "lookup-customer-by-phone-v1"
}
