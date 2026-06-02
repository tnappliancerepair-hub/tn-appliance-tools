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

    db.query customer {
      where = $db.customer.phone == $clean_phone || $db.customer.phone == $input.phone || $db.customer.phone == $digits
      sort = {customer.id: "desc"}
      return = {type: "single"}
    } as $customer

    conditional {
      if ($customer == null) {
        return {
          value = {
            found             : false
            customer          : null
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
            warranty_company    : (($j.warranty_company ?? "")|trim)
            problem_summary     : (($j.problem_summary ?? "")|trim)
          }
        }

        var.update $open_jobs_out {
          value = $open_jobs_out|push:$job_row
        }
      }
    }

    // last_call_summary: v1 empty. Future polish — query event_log
    // phone_call_summary rows filtered by customer_id in metadata, but
    // the "contains" filter on a JSON column needs proper Xano syntax.
    var $last_call_text {
      value = ""
    }
  }

  response = {
    found             : true
    customer          : $customer
    open_jobs         : $open_jobs_out
    last_call_summary : $last_call_text
  }

  guid = "lookup-customer-by-phone-v1"
}
