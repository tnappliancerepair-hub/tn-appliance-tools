query tech_sms_assist verb=POST {
  api_group = "intake"

  input {
    text phone
    text? body?
    json? media_urls?
  }

  stack {
    var $phone_in { value = (($input.phone ?? "")|trim) }
    var $body_in { value = (($input.body ?? "")|trim) }
    var $media_urls_in { value = ($input.media_urls ?? []) }
    var $media_count { value = ($media_urls_in|count) }

    // Allow body-only OR media-only inbound. Tech might send just a
    // photo of a model label with no caption.
    precondition ($phone_in != "" && ($body_in != "" || $media_count > 0)) {
      error_type = "inputerror"
      error      = "phone + (body or media_urls) required"
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

    // SCOPE GUARD (parallel ANT Phase 1): Tech Assist only runs on
    // parallel-mode jobs. Once jobs.parallel_mode column is added by
    // operator (Xano UI), this gate activates. Until then, soft-skip
    // via event_log scan — if the job has a parallel_job_created_from_email
    // marker, it's parallel-mode; else it's HCP-origin and routes to legacy.
    db.query event_log {
      where  = $db.event_log.action == "parallel_job_created_from_email"
      sort   = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $par_markers

    var $job_marker { value = ("\"job_id\":" ~ ($job_id|to_text)) }
    var $is_parallel { value = false }

    foreach ($par_markers.items) {
      each as $pm {
        conditional {
          if (!$is_parallel) {
            // metadata is returned as an object — must json_encode before
            // substring scanning for "job_id":<n>. Without json_encode,
            // |replace on the object is a no-op and the strlen check
            // always returns false (false negative for every job).
            var $pm_meta { value = ($pm.metadata ?? "")|json_encode }
            var $pm_strip { value = $pm_meta|replace:$job_marker:"" }
            conditional {
              if (($pm_meta|strlen) > ($pm_strip|strlen)) {
                var.update $is_parallel { value = true }
              }
            }
          }
        }
      }
    }

    conditional {
      if (!$is_parallel) {
        return {
          value = {matched: false, reason: "not_parallel_mode_job"}
        }
      }
    }

    var $tech_first { value = (($tech.first_name ?? "")|trim) }
    var $appliance { value = (($job.appliance_type ?? "appliance")|trim) }
    var $brand { value = (($job.brand ?? "")|trim) }
    var $problem { value = (($job.problem_summary ?? "")|trim) }

    // ─── SAVE / DONE → finalize TDR by collecting conversation so far ──
    // For SAVE, ask Claude to extract structured TDR fields from the
    // recent conversation transcript (last 20 messages for this session)
    // and call create_tdr. For v1, simpler: pull tech_assist_session
    // captured_data if present; else ask the tech to text findings first.
    // Per-tech opt-out check — Teddy can PAUSE TECH ASSIST FOR <tech_id>
    // via the preference inbound. Look up most recent pause/resume event
    // for this tech; if last action was a pause, route to legacy.
    db.query event_log {
      where  = $db.event_log.action == "tech_assist_paused" || $db.event_log.action == "tech_assist_resumed"
      sort   = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $pause_events

    var $latest_pause_state { value = "" }
    var $tech_marker { value = "\"tech_id\":" ~ ($tech_id|to_text) }

    foreach ($pause_events.items) {
      each as $pe {
        conditional {
          if ($latest_pause_state == "") {
            // Same json_encode requirement as the parallel-mode scan above.
            var $pe_meta_raw { value = ($pe.metadata ?? "")|json_encode }
            var $pe_strip { value = $pe_meta_raw|replace:$tech_marker:"" }
            conditional {
              if (($pe_meta_raw|strlen) > ($pe_strip|strlen)) {
                var.update $latest_pause_state { value = ($pe.action ?? "") }
              }
            }
          }
        }
      }
    }

    conditional {
      if ($latest_pause_state == "tech_assist_paused") {
        return {
          value = {matched: false, reason: "tech_assist_paused_for_tech"}
        }
      }
    }

    var $body_u { value = $body_in|upper|trim }
    var $is_save_cmd { value = ($body_u == "SAVE" || $body_u == "DONE" || $body_u == "SUBMIT" || $body_u == "FINALIZE" || $body_u == "COMPLETE" || $body_u == "THATS IT" || $body_u == "THAT'S IT") }

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

    // ─── Delegate to tech-assist-brain Netlify function ──────────────
    // The brain handles multi-turn Claude tool-calling (Claude can fetch
    // customer service history, common failures for the model, etc.
    // before composing its reply). Same model (Sonnet 4.5) and same
    // {reply, captured} contract — the swap is transparent here.
    //
    // Why Netlify not inline XS: tool-calling is multi-turn (call Claude
    // → tool_use blocks → execute → tool_result → loop). XS has no clean
    // way to do that without try/catch or while loops.
    api.request {
      url    = "https://tnapplianceexchange.net/.netlify/functions/tech-assist-brain"
      method = "POST"
      headers = [
        "content-type: application/json"
      ]
      params = {
        tech_id           : $tech_id
        tech_first_name   : $tech_first
        job_id            : $job_id
        customer_id       : ($job.customer_id ?? 0)
        brand             : $brand
        appliance         : $appliance
        problem           : $problem
        warranty_company  : ($job.warranty_company ?? "")
        message           : $body_in
        media_urls        : $media_urls_in
        existing_captured : $existing_captured
      }
      timeout = 30
    } as $brain_resp

    var $chat_status { value = ($brain_resp.response.status ?? 0) }
    var $brain_result { value = ($brain_resp.response.result ?? {}) }

    var $reply_text { value = (($brain_result.reply ?? "")|trim) }
    var $new_captured { value = ($brain_result.captured ?? {}) }

    // Audit row for every brain call — captures tool_calls log so we can
    // see what Claude looked up + how often. Useful for tuning the tool
    // descriptions over time.
    db.add event_log {
      data = {
        action  : "tech_assist_brain_call"
        metadata: {
          job_id     : $job_id
          tech_id    : $tech_id
          chat_status: $chat_status
          reply_len  : ($reply_text|strlen)
          tool_calls : ($brain_result.tool_calls ?? [])
          error      : ($brain_result.error ?? null)
        }
      }
    } as $brain_audit

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

    var $nc_replaced_by { value = (($new_captured.replaced_by_part_number ?? "")|trim) }
    conditional {
      if ($nc_replaced_by != "") {
        var.update $merged_captured { value = $merged_captured|set:"replaced_by_part_number":$nc_replaced_by }
      }
    }

    var $nc_parts_status { value = (($new_captured.parts_status ?? "")|trim) }
    conditional {
      if ($nc_parts_status != "") {
        var.update $merged_captured { value = $merged_captured|set:"parts_status":$nc_parts_status }
      }
    }

    var $nc_recommend { value = (($new_captured.recommendation ?? "")|trim) }
    conditional {
      if ($nc_recommend != "") {
        var.update $merged_captured { value = $merged_captured|set:"recommendation":$nc_recommend }
      }
    }

    // Debug log every write — required for triage during rollout
    db.add event_log {
      data = {
        action  : "tdr_write_from_sms"
        metadata: {
          job_id           : $job_id
          tech_id          : $tech_id
          diag_new         : $nc_diag
          comp_new         : $nc_comp
          part_new         : $nc_part
          replaced_new     : $nc_replaced_by
          labor_new        : $nc_labor
          repair_new       : $nc_repair
          parts_status_new : $nc_parts_status
          recommend_new    : $nc_recommend
          inbound          : ($body_in|substr:0:200)
        }
      }
    } as $tdr_write_log_row

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

    // AUTO-FINALIZE: if merged_captured has all 4 core fields, save the TDR
    // automatically (don't require explicit SAVE text from tech). This is
    // the ONE-SHOT save path Teddy specified.
    var $m_diag { value = (($merged_captured.diagnosis ?? "")|trim) }
    var $m_comp { value = (($merged_captured.failed_component ?? "")|trim) }
    var $m_labor { value = (($merged_captured.labor_hours ?? "")|to_text|trim) }
    var $m_repair { value = (($merged_captured.repair_completed ?? "")|trim) }
    var $m_part { value = (($merged_captured.verified_part_number ?? "")|trim) }
    var $m_replaced { value = (($merged_captured.replaced_by_part_number ?? "")|trim) }

    var $all_4_present {
      value = ($m_diag != "") && ($m_comp != "") && ($m_labor != "" && $m_labor != "0") && ($m_repair != "")
    }

    conditional {
      if ($all_4_present) {
        // Check if a TDR was already saved for this tech+job in this session
        // window to avoid duplicate creates. Look for tech_sms_tdr_saved
        // event_log in last 2 hours.
        var $now_ms_check { value = now|to_ms }
        var $two_hr_ago { value = $now_ms_check - 7200000 }

        db.query event_log {
          where  = $db.event_log.action == "tech_sms_tdr_saved" && $db.event_log.created_at >= $two_hr_ago
          sort   = {event_log.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 10}}
        } as $recent_saves

        var $already_saved { value = false }

        foreach ($recent_saves.items) {
          each as $sv {
            conditional {
              if (!$already_saved) {
                // metadata from db.query is an object — must json_encode
                // before substring scan. |replace on raw object is a silent
                // no-op (same footgun fixed earlier in this file's
                // parallel-mode scope guard).
                var $sv_meta_raw { value = ($sv.metadata ?? "")|json_encode }
                var $sv_marker { value = "\"job_id\":" ~ ($job_id|to_text) }
                var $sv_strip { value = $sv_meta_raw|replace:$sv_marker:"" }
                conditional {
                  if (($sv_meta_raw|strlen) > ($sv_strip|strlen)) {
                    var.update $already_saved { value = true }
                  }
                }
              }
            }
          }
        }

        conditional {
          if (!$already_saved) {
            var $labor_num { value = $m_labor|to_decimal }

            api.request {
              url     = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/create_tdr"
              method  = "POST"
              headers = []|push:"Content-Type: application/json"
              params  = {
                job_id                  : $job_id
                technician_id           : $tech_id
                technician_first_name   : $tech_first
                diagnosis               : $m_diag
                failed_component        : $m_comp
                failure_description     : $m_diag
                labor_time_hours        : $labor_num
                repair_completed        : $m_repair
                verified_part_number    : $m_part
                final_recommendation    : "repair_complete"
              }
            } as $auto_tdr_resp

            var $auto_tdr_status { value = ($auto_tdr_resp.response.status ?? 0) }

            db.add event_log {
              data = {
                action  : "tech_sms_tdr_saved"
                metadata: {
                  job_id        : $job_id
                  tech_id       : $tech_id
                  tdr_status    : $auto_tdr_status
                  auto          : true
                  diag_len      : ($m_diag|strlen)
                  labor         : $m_labor
                }
              }
            } as $auto_save_log

            // Override reply_text with one-shot save confirmation
            var.update $reply_text {
              value = "TDR saved. " ~ $m_comp ~ ", " ~ $m_labor ~ "h, " ~ $m_repair
            }
          }
          else {
            // TDR already saved in last 2h — suppress Claude's "TDR saved..."
            // reply so the tech doesn't get duplicate confirmations.
            var.update $reply_text { value = "" }
          }
        }
      }
    }

    // SILENT MODE: if reply_text is empty, don't send. Saves tech attention.
    conditional {
      if (($reply_text|trim) != "") {
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
    }
  }

  response = {
    matched      : true
    job_id       : $job_id
    chat_status  : $chat_status
    reply_len    : ($reply_text|strlen)
    auto_saved   : $all_4_present
  }

  guid = "tech-sms-assist-v1"
}
