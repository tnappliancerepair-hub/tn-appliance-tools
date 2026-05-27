// Customer-side: get the most recent tech position for THIS customer's
// current job. Phone-last4 gated so only the auth'd customer can see
// their own tech's truck position.
//
// Privacy/lifecycle:
//   - Returns position only when scheduling_status='in_progress' (en-route
//     or actively working) OR when tech_en_route_at is set (legacy path)
//   - Returns null when job hasn't started OR has completed
//   - Position rows older than 10 min are considered stale (returns null)
//
// Customer portal polls this every ~20s to update its truck map.
query get_tech_position_for_customer verb=POST {
  api_group = "intake"

  input {
    int  job_id
    text phone_last4
  }

  stack {
    var $jid { value = ($input.job_id ?? 0) }
    var $last4_in { value = (($input.phone_last4 ?? "")|trim) }

    precondition ($jid > 0 && $last4_in != "") {
      error_type = "inputerror"
      error      = "job_id + phone_last4 required"
    }

    // Gate: validate phone_last4 against the job's customer
    db.get jobs {
      field_name  = "id"
      field_value = $jid
    } as $job

    var $cust_id { value = ($job.customer_id ?? 0) }
    precondition ($cust_id > 0) {
      error_type = "notfound"
      error      = "job not found"
    }

    db.get customer {
      field_name  = "id"
      field_value = $cust_id
    } as $cust

    var $cust_phone_raw { value = (($cust.phone ?? "")|replace:"+":""|replace:"-":""|replace:"(":""|replace:")":""|replace:" ":"") }
    var $cust_phone_len { value = $cust_phone_raw|strlen }
    var $cust_last4_start { value = $cust_phone_len - 4 }
    var $cust_last4 { value = ($cust_phone_len >= 4) ? ($cust_phone_raw|substr:$cust_last4_start) : "" }

    precondition ($cust_last4 == $last4_in) {
      error_type = "accessdenied"
      error      = "phone_last4 does not match"
    }

    // Eligibility: only return position when job is in_progress (tech
    // en-route or working) OR has tech_en_route_at stamped. Don't leak
    // pings from completed/scheduled jobs.
    var $sched_status { value = (($job.scheduling_status ?? "")|trim) }
    var $en_route_at { value = ($job.tech_en_route_at ?? 0) }
    var $started_at { value = ($job.job_started_at ?? 0) }

    var $is_eligible { value = ($sched_status == "in_progress") || ($en_route_at > 0 && $started_at == 0) }

    var $response_obj {
      value = {
        success: true
        eligible: $is_eligible
        position: null
        recorded_at: 0
        age_seconds: 0
        tech_first_name: ""
        eta_minutes: null
      }
    }

    conditional {
      if ($is_eligible) {
        // Pull most recent tech_position_ping for this job in last 10 min
        var $now_ms { value = now|to_ms }
        var $ten_min_ago { value = $now_ms - 600000 }

        db.query event_log {
          where  = $db.event_log.action == "tech_position_ping" && $db.event_log.created_at >= $ten_min_ago
          sort   = {event_log.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 100}}
        } as $pings

        var $needle { value = "\"job_id\":" ~ ($jid|to_text) }
        var $latest_ping_id { value = 0 }
        var $latest_ping_ts { value = 0 }
        var $latest_lat { value = "" }
        var $latest_lng { value = "" }

        foreach ($pings.items) {
          each as $p {
            conditional {
              if ($latest_ping_id == 0) {
                var $meta_str { value = ($p.metadata ?? "")|json_encode }
                var $strip { value = $meta_str|replace:$needle:"" }
                conditional {
                  if (($meta_str|strlen) > ($strip|strlen)) {
                    var.update $latest_ping_id { value = $p.id }
                    var.update $latest_ping_ts { value = $p.created_at }
                    var.update $latest_lat { value = (($p.metadata.lat ?? "")|to_text) }
                    var.update $latest_lng { value = (($p.metadata.lng ?? "")|to_text) }
                  }
                }
              }
            }
          }
        }

        conditional {
          if ($latest_ping_id > 0) {
            // Pull tech first name
            var $tech_first { value = "" }
            var $tech_id { value = ($job.technician_id ?? 0) }
            conditional {
              if ($tech_id > 0) {
                db.get technicians {
                  field_name  = "id"
                  field_value = $tech_id
                } as $tech_row
                var.update $tech_first { value = (($tech_row.first_name ?? "")|trim) }
              }
            }
            var $age_sec { value = (($now_ms - $latest_ping_ts) / 1000)|round }
            var.update $response_obj {
              value = $response_obj
                |set:"position":{"lat": $latest_lat, "lng": $latest_lng}
                |set:"recorded_at":$latest_ping_ts
                |set:"age_seconds":$age_sec
                |set:"tech_first_name":$tech_first
                |set:"eta_minutes":($job.eta_minutes ?? null)
            }
          }
        }
      }
    }
  }

  response = $response_obj

  guid = "get-tech-position-for-customer-v1"
}
