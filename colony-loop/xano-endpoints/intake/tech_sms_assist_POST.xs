query tech_sms_assist verb=POST {
  api_group = "intake"

  input {
    text phone
    text body
  }

  stack {
    var $phone_in { value = (($input.phone ?? "")|trim) }
    var $body_in { value = (($input.body ?? "")|trim) }

    precondition ($phone_in != "" && $body_in != "") {
      error_type = "inputerror"
      error      = "phone and body required"
    }

    var $digits_only { value = $phone_in|replace:"+":""|replace:"-":""|replace:"(":""|replace:")":""|replace:" ":"" }
    var $dig_len { value = $digits_only|strlen }
    var $last10_start { value = $dig_len - 10 }
    var $last10 { value = ($dig_len >= 10) ? ($digits_only|substr:$last10_start) : $digits_only }

    db.query technicians {
      where  = $db.technicians.phone == $last10 || $db.technicians.phone == ("+1" ~ $last10) || $db.technicians.phone == $phone_in
      sort   = {technicians.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $tech_rows

    var $tech_count { value = ($tech_rows.items|count) }

    conditional {
      if ($tech_count == 0) {
        return {
          value = {matched: false, reason: "unknown_tech_phone"}
        }
      }
    }

    var $tech { value = $tech_rows.items|get:0 }
    var $tech_id { value = $tech.id }

    db.query jobs {
      where  = $db.jobs.technician_id == $tech_id && $db.jobs.scheduling_status == "in_progress"
      sort   = {jobs.id: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $active_rows

    var $active_count { value = ($active_rows.items|count) }

    conditional {
      if ($active_count == 0) {
        return {
          value = {matched: false, reason: "no_active_job"}
        }
      }
    }

    var $job { value = $active_rows.items|get:0 }
    var $job_id { value = $job.id }

    var $tech_first { value = (($tech.first_name ?? "")|trim) }
    var $appliance { value = (($job.appliance_type ?? "appliance")|trim) }
    var $brand { value = (($job.brand ?? "")|trim) }
    var $problem { value = (($job.problem_summary ?? "")|trim) }

    // ─── SAVE / DONE → finalize TDR by collecting conversation so far ──
    // For SAVE, ask Claude to extract structured TDR fields from the
    // recent conversation transcript (last 20 messages for this session)
    // and call create_tdr. For v1, simpler: pull tech_assist_session
    // captured_data if present; else ask the tech to text findings first.
    var $body_u { value = $body_in|upper }
    var $is_save_cmd { value = ($body_u == "SAVE" || $body_u == "DONE" || $body_u == "SUBMIT" || $body_u == "FINALIZE") }

    conditional {
      if ($is_save_cmd) {
        // Pull most recent tech_assist_session for this (job, tech)
        db.query tech_assist_session {
          where  = $db.tech_assist_session.job_id == $job_id && $db.tech_assist_session.technician_id == $tech_id
          sort   = {tech_assist_session.id: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $sess_rows

        var $sess_count { value = ($sess_rows.items|count) }

        conditional {
          if ($sess_count == 0) {
            api.request {
              url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
              method  = "POST"
              headers = []|push:"Content-Type: application/json"
              params  = {
                to              : $phone_in
                message         : "I don't have a TDR draft yet — text me your findings first (what failed, the part number, labor hours, what you did), then text SAVE."
                context_tag     : "sms_tdr_save_no_draft"
              }
            } as $no_draft_send

            return {
              value = {matched: true, action: "save_no_draft"}
            }
          }
        }

        var $sess { value = $sess_rows.items|get:0 }
        // captured_data is a json column on tech_assist_session — should
        // come back as an object directly (no json_decode needed)
        var $captured { value = ($sess.captured_data ?? {}) }

        var $diag { value = (($captured.diagnosis ?? "")|trim) }
        var $failed { value = (($captured.failed_component ?? "")|trim) }
        var $labor_raw { value = ($captured.labor_hours ?? "") }
        var $labor_str { value = $labor_raw|to_text }
        var $repair { value = (($captured.repair_completed ?? "")|trim) }
        var $part { value = (($captured.verified_part_number ?? "")|trim) }

        var $missing { value = "" }
        conditional {
          if ($diag == "")    { var.update $missing { value = ($missing ~ " diagnosis") } }
        }
        conditional {
          if ($failed == "")  { var.update $missing { value = ($missing ~ " failed_component") } }
        }
        conditional {
          if ($labor_str == "" || $labor_str == "0") { var.update $missing { value = ($missing ~ " labor_hours") } }
        }
        conditional {
          if ($repair == "")  { var.update $missing { value = ($missing ~ " repair_completed") } }
        }

        conditional {
          if (($missing|trim) != "") {
            api.request {
              url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
              method  = "POST"
              headers = []|push:"Content-Type: application/json"
              params  = {
                to              : $phone_in
                message         : ("Almost — still need:" ~ $missing ~ ". Text those then SAVE again.")
                context_tag     : "sms_tdr_save_missing"
              }
            } as $miss_send

            return {
              value = {matched: true, action: "save_missing_fields"}
            }
          }
        }

        // All fields present — call create_tdr
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

        var $save_reply {
          value = $tdr_ok ? ("TDR saved for job #" ~ ($job_id|to_text) ~ ". Tap Complete in your Ant page when ready to wrap up.") : "TDR save hiccup — text Teddy at 615-485-5795 so we can complete this manually."
        }

        api.request {
          url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
          method  = "POST"
          headers = []|push:"Content-Type: application/json"
          params  = {
            to              : $phone_in
            message         : $save_reply
            context_tag     : "sms_tdr_saved"
          }
        } as $save_send

        return {
          value = {matched: true, action: "tdr_saved", tdr_status: $tdr_status}
        }
      }
    }

    // Pull existing captured_data so the prompt has context on which
    // fields are already filled vs which are still missing
    db.query tech_assist_session {
      where  = $db.tech_assist_session.job_id == $job_id && $db.tech_assist_session.technician_id == $tech_id
      sort   = {tech_assist_session.id: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $existing_sess_rows

    var $existing_sess_count { value = ($existing_sess_rows.items|count) }
    var $existing_captured { value = {} }
    var $existing_sess_id { value = 0 }

    conditional {
      if ($existing_sess_count > 0) {
        var $sess_row { value = $existing_sess_rows.items|get:0 }
        var.update $existing_captured { value = ($sess_row.captured_data ?? {}) }
        var.update $existing_sess_id { value = $sess_row.id }
      }
    }

    var $existing_captured_json { value = $existing_captured|json_encode }

    // Build the system prompt inline. Claude must output JSON so we can
    // both reply AND upsert structured TDR fields each turn.
    var $sys_prompt {
      value = "You are Ant, an in-truck assistant for appliance-repair technicians via SMS. The tech is on-site working a job. Output ONLY valid JSON, no prose, no markdown fences. Schema: {\"reply\": \"your SMS reply under 160 chars\", \"captured\": {\"diagnosis\": string?, \"failed_component\": string?, \"labor_hours\": string?, \"repair_completed\": string?, \"verified_part_number\": string?}}. The 'captured' object should contain ONLY fields you can confidently extract from the tech's LATEST message — omit fields you don't have. Coaching style for 'reply': ask for ONE missing field at a time (the gaps after merging your extraction with what's already captured), under 160 chars, plain text. If all 4 core fields (diagnosis, failed_component, labor_hours, repair_completed) are present after this turn, reply with: \"TDR ready: diagnosis OK part OK labor OK repair done OK. Text SAVE when ready.\" Job context: tech=" ~ $tech_first ~ " job#" ~ ($job_id|to_text) ~ " appliance=" ~ $brand ~ " " ~ $appliance ~ " problem=" ~ $problem ~ ". Already captured this session: " ~ $existing_captured_json
    }

    var $user_msg_obj { value = {role: "user", content: $body_in} }

    api.request {
      url = "https://api.anthropic.com/v1/messages"
      method = "POST"
      params = {
        model     : "claude-haiku-4-5-20251001"
        max_tokens: 250
        system    : $sys_prompt
        messages  : [$user_msg_obj]
      }
      headers = [
        "x-api-key: " ~ $env.ANTHROPIC_API_KEY
        "anthropic-version: 2023-06-01"
        "content-type: application/json"
      ]
      timeout = 8
    } as $claude_resp

    var $chat_status { value = ($claude_resp.response.status ?? 0) }
    var $claude_result { value = ($claude_resp.response.result ?? {}) }
    var $claude_content { value = ($claude_result.content ?? []) }
    var $claude_content_count { value = ($claude_content|count) }

    var $reply_text { value = "got it. keep going — text more findings or SAVE when done." }
    var $new_captured { value = {} }

    conditional {
      if ($claude_content_count > 0) {
        var $first_block { value = $claude_content|get:0 }
        var $raw_text { value = (($first_block.text ?? "")|trim) }
        var $cleaned { value = ($raw_text|replace:"```json":""|replace:"```":"")|trim }
        var $parsed { value = $cleaned|json_decode }
        conditional {
          if ($parsed != null) {
            var $parsed_reply { value = (($parsed.reply ?? "")|trim) }
            conditional {
              if ($parsed_reply != "") {
                var.update $reply_text { value = $parsed_reply }
              }
            }
            var.update $new_captured { value = ($parsed.captured ?? {}) }
          }
          else {
            // Claude didn't return JSON — fall back to using raw text as the reply
            conditional {
              if ($raw_text != "") {
                var.update $reply_text { value = $raw_text }
              }
            }
          }
        }
      }
    }

    // Merge new_captured onto existing_captured (only non-empty new fields win)
    var $merged_captured { value = $existing_captured }

    var $nc_diag { value = (($new_captured.diagnosis ?? "")|trim) }
    conditional {
      if ($nc_diag != "") {
        var.update $merged_captured { value = $merged_captured|set:"diagnosis":$nc_diag }
      }
    }

    var $nc_comp { value = (($new_captured.failed_component ?? "")|trim) }
    conditional {
      if ($nc_comp != "") {
        var.update $merged_captured { value = $merged_captured|set:"failed_component":$nc_comp }
      }
    }

    var $nc_labor { value = (($new_captured.labor_hours ?? "")|to_text|trim) }
    conditional {
      if ($nc_labor != "" && $nc_labor != "0") {
        var.update $merged_captured { value = $merged_captured|set:"labor_hours":$nc_labor }
      }
    }

    var $nc_repair { value = (($new_captured.repair_completed ?? "")|trim) }
    conditional {
      if ($nc_repair != "") {
        var.update $merged_captured { value = $merged_captured|set:"repair_completed":$nc_repair }
      }
    }

    var $nc_part { value = (($new_captured.verified_part_number ?? "")|trim) }
    conditional {
      if ($nc_part != "") {
        var.update $merged_captured { value = $merged_captured|set:"verified_part_number":$nc_part }
      }
    }

    // Upsert tech_assist_session.captured_data
    var $now_ms_upd { value = now|to_ms }

    conditional {
      if ($existing_sess_id > 0) {
        db.edit tech_assist_session {
          field_name  = "id"
          field_value = $existing_sess_id
          data        = {
            captured_data    : $merged_captured
            last_message_at  : now
            updated_at       : now
          }
        } as $sess_updated
      }
      else {
        db.add tech_assist_session {
          data = {
            job_id              : $job_id
            technician_id       : $tech_id
            captured_data       : $merged_captured
            session_start_event : "sms_first_turn"
            last_message_at     : now
            updated_at          : now
            status              : "active"
          }
        } as $sess_created
      }
    }

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
  }

  response = {
    matched     : true
    job_id      : $job_id
    chat_status : $chat_status
    reply_len   : ($reply_text|strlen)
  }

  guid = "tech-sms-assist-v1"
}
