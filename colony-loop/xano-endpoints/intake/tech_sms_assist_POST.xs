// SMS-driven Tech Ant Assist. Called by the Netlify tech-sms-inbound
// webhook AFTER the preference-shortcut interceptor — handles inbound
// free-text from techs about an in-progress job.
//
// Flow:
//   1. Look up tech by phone
//   2. Find their current in_progress job (most recent if multiple)
//   3. If no in_progress job → return matched=false (fall through to legacy)
//   4. If body is "SAVE" / "DONE" / "TDR DONE" → finalize by calling
//      create_tdr with the accumulated session.captured_data, SMS confirm
//   5. Else → call tech_assist_chat with the message + job context,
//      send the Claude reply back via send_sms
//
// Returns matched=true so the webhook short-circuits and doesn't
// double-process via the legacy tech_sms_inbound flow.
query tech_sms_assist verb=POST {
  api_group = "intake"

  input {
    text phone
    text body
  }

  stack {
    var $phone_in { value = (($input.phone ?? "")|trim) }
    var $body_in { value = (($input.body ?? "")|trim) }
    var $body_u { value = $body_in|upper }

    precondition ($phone_in != "" && $body_in != "") {
      error_type = "inputerror"
      error      = "phone and body required"
    }

    // Resolve tech by phone (try multiple formats)
    var $digits_only { value = $phone_in|replace:"+":""|replace:"-":""|replace:"(":""|replace:")":""|replace:" ":"" }
    var $dig_len { value = $digits_only|strlen }
    var $last10_start { value = $dig_len - 10 }
    var $last10 { value = ($dig_len >= 10) ? ($digits_only|substr:$last10_start) : $digits_only }

    db.query technicians {
      where  = $db.technicians.phone == $last10 || $db.technicians.phone == ("+1" ~ $last10) || $db.technicians.phone == $phone_in
      sort   = {technicians.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $tech_rows

    var $tech { value = (($tech_rows.items|first) ?? null) }

    conditional {
      if ($tech == null) {
        return {
          value = {matched: false, reason: "unknown_tech_phone"}
        }
      }
    }

    var $tech_id { value = $tech.id }
    var $tech_first { value = (($tech.first_name ?? "")|trim) }

    // Find tech's in_progress job — most recent
    db.query jobs {
      where  = $db.jobs.technician_id == $tech_id && $db.jobs.scheduling_status == "in_progress"
      sort   = {jobs.job_started_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $active_rows

    var $job { value = (($active_rows.items|first) ?? null) }

    conditional {
      if ($job == null) {
        // No active job → free-text falls through to legacy handler
        // (CLAIM/PICK/RESCHEDULE keywords or Claude open-ended chat)
        return {
          value = {matched: false, reason: "no_active_job"}
        }
      }
    }

    var $job_id { value = $job.id }

    // ─── SAVE / DONE → finalize TDR ──────────────────────────────────
    var $is_save_cmd {
      value = ($body_u == "SAVE" || $body_u == "DONE" || $body_u == "TDR DONE" || $body_u == "SUBMIT" || $body_u == "FINALIZE")
    }

    conditional {
      if ($is_save_cmd) {
        // Pull the latest session.captured_data for this tech+job
        db.query tech_assist_session {
          where  = $db.tech_assist_session.job_id == $job_id && $db.tech_assist_session.technician_id == $tech_id
          sort   = {tech_assist_session.updated_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $sess_rows

        var $sess { value = (($sess_rows.items|first) ?? null) }

        conditional {
          if ($sess == null) {
            return {
              value = {matched: true, reply: "No TDR draft in progress yet — text me your diagnosis first."}
            }
          }
        }

        var $captured_raw { value = ($sess.captured_data ?? "{}") }
        var $captured { value = $captured_raw|json_decode }

        var $diag { value = (($captured.diagnosis ?? "")|trim) }
        var $failed { value = (($captured.failed_component ?? "")|trim) }
        var $labor_str { value = (($captured.labor_hours ?? "")|to_text)|trim }
        var $repair { value = (($captured.repair_completed ?? "")|trim) }
        var $part { value = (($captured.part_number ?? ($captured.verified_part_number ?? ""))|trim) }

        // Check required fields for warranty submission
        var $missing_list { value = [] }
        conditional {
          if ($diag == "")   { var.update $missing_list { value = $missing_list|push:"diagnosis" } }
        }
        conditional {
          if ($failed == "") { var.update $missing_list { value = $missing_list|push:"failed_component" } }
        }
        conditional {
          if ($labor_str == "" || $labor_str == "0") { var.update $missing_list { value = $missing_list|push:"labor_hours" } }
        }
        conditional {
          if ($repair == "") { var.update $missing_list { value = $missing_list|push:"repair_completed" } }
        }

        var $missing_count { value = $missing_list|count }

        conditional {
          if ($missing_count > 0) {
            var $missing_text { value = $missing_list|implode:", " }
            return {
              value = {matched: true, reply: ("Almost — still need: " ~ $missing_text ~ ". Reply with those + then SAVE again.")}
            }
          }
        }

        // All required fields present — call create_tdr
        var $labor_num { value = $labor_str|to_decimal }

        api.request {
          url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/create_tdr"
          method  = "POST"
          headers = []|push:"Content-Type: application/json"
          params  = {
            job_id                  : $job_id
            technician_id           : $tech_id
            technician_first_name   : $tech_first
            diagnosis               : $diag
            failed_component        : $failed
            failure_description     : $diag
            labor_time_hours        : $labor_num
            repair_completed        : $repair
            verified_part_number    : $part
            final_recommendation    : "repair_complete"
          }
        } as $tdr_resp

        var $tdr_status { value = ($tdr_resp.response.status ?? 0) }
        var $tdr_ok { value = ($tdr_status >= 200 && $tdr_status < 300) }

        db.add event_log {
          data = {
            action  : "tech_sms_assist_tdr_saved"
            metadata: {
              job_id        : $job_id
              tech_id       : $tech_id
              tdr_status    : $tdr_status
              diagnosis_len : ($diag|strlen)
              part_present  : ($part != "")
            }
          }
        } as $audit

        conditional {
          if (!$tdr_ok) {
            return {
              value = {matched: true, reply: "TDR save hiccup — text Teddy at 615-485-5795 so we can complete this manually."}
            }
          }
        }

        // SMS the success confirmation
        api.request {
          url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method  = "POST"
          headers = []|push:"Content-Type: application/json"
          params  = {
            to              : $phone_in
            message         : ("TDR saved for job #" ~ ($job_id|to_text) ~ ". Tap Complete in your Ant page when you're ready to wrap up.")
            context_tag     : "sms_tdr_saved"
          }
        } as $confirm_send

        return {
          value = {matched: true, action: "tdr_saved", job_id: $job_id}
        }
      }
    }

    // ─── Regular conversation turn — route through tech_assist_chat ──
    api.request {
      url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/tech_assist_chat"
      method  = "POST"
      headers = []|push:"Content-Type: application/json"
      params  = {
        job_id         : $job_id
        technician_id  : $tech_id
        user_message   : $body_in
        session_id     : 0
        attachment_ids : []
      }
    } as $chat_resp

    var $chat_status { value = ($chat_resp.response.status ?? 0) }
    var $chat_ok { value = ($chat_status >= 200 && $chat_status < 300) }

    conditional {
      if (!$chat_ok) {
        return {
          value = {matched: true, reply: "Ant brain hiccup — try again in a sec or text Teddy at 615-485-5795."}
        }
      }
    }

    var $chat_result { value = ($chat_resp.response.result ?? {}) }
    var $reply_text { value = (($chat_result.reply ?? "")|trim) }

    conditional {
      if ($reply_text == "") {
        var.update $reply_text { value = "got it. keep going — text more findings or SAVE when the TDR is filled." }
      }
    }

    // Send the Claude reply back via SMS
    api.request {
      url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method  = "POST"
      headers = []|push:"Content-Type: application/json"
      params  = {
        to              : $phone_in
        message         : $reply_text
        context_tag     : "sms_tdr_assist_reply"
      }
    } as $reply_send

    db.add event_log {
      data = {
        action  : "tech_sms_assist_turn"
        metadata: {
          job_id          : $job_id
          tech_id         : $tech_id
          inbound_len     : ($body_in|strlen)
          reply_len       : ($reply_text|strlen)
          send_status     : ($reply_send.response.status ?? 0)
        }
      }
    } as $turn_log
  }

  response = {
    matched : true
    action  : "assist_turn"
    job_id  : $job_id
  }

  guid = "tech-sms-assist-v1"
}
