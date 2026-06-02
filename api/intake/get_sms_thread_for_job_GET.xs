// Universal SMS thread for a given job. Scans event_log for SMS-related
// actions, filters to rows mentioning this job's customer (by id, phone,
// or job_id substring), returns chronological.
query get_sms_thread_for_job verb=GET {
  api_group = "intake"

  input {
    int job_id
    int? hours_back?
  }

  stack {
    var $hours { value = ($input.hours_back ?? 720) }
    var $cutoff { value = (now|to_ms) - ($hours * 3600000) }

    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    var $customer_id { value = ($job.customer_id ?? 0) }
    var $cust_phone { value = "" }

    conditional {
      if ($customer_id > 0) {
        db.get customer {
          field_name = "id"
          field_value = $customer_id
        } as $cust
        var.update $cust_phone { value = (($cust.phone ?? "")|trim) }
      }
    }

    var $marker_job  { value = "\"job_id\":" ~ ($input.job_id|to_text) }
    var $marker_cust { value = "\"customer_id\":" ~ ($customer_id|to_text) }
    var $phone_has_value { value = (($cust_phone|strlen) > 0) }

    db.query event_log {
      where = $db.event_log.created_at >= $cutoff && ($db.event_log.action == "sms_sent" || $db.event_log.action == "sms_gated" || $db.event_log.action == "dropped_customer_sms" || $db.event_log.action == "sms_owner_bypass" || $db.event_log.action == "inbound_customer_sms_received" || $db.event_log.action == "feedback_sms_sent" || $db.event_log.action == "teddy_sms_triggered")
      sort = {event_log.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1000}}
    } as $rows

    var $messages { value = [] }

    foreach ($rows.items) {
      each as $r {
        var $meta_str { value = ($r.metadata|json_encode) }
        var $len_a    { value = $meta_str|strlen }

        var $stripped_j { value = $meta_str|replace:$marker_job:"" }
        var $len_j     { value = $stripped_j|strlen }
        var $hit_job   { value = ($len_j < $len_a) }

        var $stripped_c { value = $meta_str|replace:$marker_cust:"" }
        var $len_c     { value = $stripped_c|strlen }
        var $hit_cust  { value = (($customer_id > 0) && ($len_c < $len_a)) }

        var $hit_phone { value = false }
        conditional {
          if ($phone_has_value == true) {
            var $stripped_p { value = $meta_str|replace:$cust_phone:"" }
            var $len_p     { value = $stripped_p|strlen }
            conditional {
              if ($len_p < $len_a) {
                var.update $hit_phone { value = true }
              }
            }
          }
        }

        conditional {
          if ($hit_job == true || $hit_cust == true || $hit_phone == true) {
            var.update $messages {
              value = $messages|push:{
                id        : $r.id
                ts_ms     : $r.created_at
                action    : $r.action
                metadata  : $r.metadata
              }
            }
          }
        }
      }
    }
  }

  response = {
    success        : true
    job_id         : $input.job_id
    customer_id    : $customer_id
    customer_phone : $cust_phone
    hours_back     : $hours
    message_count  : ($messages|count)
    messages       : $messages
  }

  guid = "get-sms-thread-for-job-v1"
}
