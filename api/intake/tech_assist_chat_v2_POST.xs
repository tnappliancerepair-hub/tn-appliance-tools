// Tech Ant Assist chat — v2 (scribe-mode brain).
//
// Replaces the legacy `tech_assist_chat` Anthropic-direct call (with the
// flaky __CAPTURE_FIELD__ token scheme) by delegating to the proven
// `tech-assist-brain` Netlify function — same scribe-mode brain that
// tech_sms_assist already uses for SMS. Returns reply + captured fields
// as structured JSON so the browser can populate the inline TDR form
// directly.
//
// Caller (tech-ant-chat.html) sends:
//   { job_id, technician_id, user_message, session_id?, attachment_ids? }
// Returns:
//   { success, reply, session_id, captured_data }
//
// Differences from v1:
//   - No __CAPTURE_FIELD__/__QUERY_STATUS__/__ESCALATE_TO_OFFICE__ tokens
//   - Brain returns structured {reply, captured} directly
//   - captured_data merged onto session.captured_data + returned to client
//   - Browser writes captured_data fields into inline TDR form on each turn

query tech_assist_chat_v2 verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id
    text user_message filters=trim
    int? session_id?
    json? attachment_ids?
  }

  stack {
    // ── 1. Resolve or lazy-create session ──
    var $session {
      value = null
    }

    conditional {
      if ($input.session_id != null && $input.session_id > 0) {
        db.get tech_assist_session {
          field_name = "id"
          field_value = $input.session_id
        } as $session
      }
      else {
        db.query tech_assist_session {
          where = $db.tech_assist_session.job_id == $input.job_id && $db.tech_assist_session.technician_id == $input.technician_id && ($db.tech_assist_session.status == "active" || $db.tech_assist_session.status == "awaiting_completion")
          sort = {tech_assist_session.created_at: "desc"}
          return = {type: "single"}
        } as $session
      }
    }

    conditional {
      if ($session == null) {
        db.get jobs {
          field_name = "id"
          field_value = $input.job_id
        } as $lazy_job

        var $lazy_warranty_co_raw {
          value = ($lazy_job.warranty_company ?? "")|trim
        }

        var $lazy_warranty_co {
          value = ($lazy_warranty_co_raw != "") ? $lazy_warranty_co_raw : "unknown"
        }

        var $lazy_cust_type_raw {
          value = ($lazy_job.customer_type ?? "")|trim
        }

        var $lazy_cust_type {
          value = ($lazy_cust_type_raw == "warranty" || $lazy_cust_type_raw == "self_pay") ? $lazy_cust_type_raw : "warranty"
        }

        db.add tech_assist_session {
          data = {
            job_id                   : $input.job_id
            technician_id            : $input.technician_id
            status                   : "active"
            warranty_company         : $lazy_warranty_co
            customer_type            : $lazy_cust_type
            required_fields_remaining: []
            captured_data            : {}
            session_started_at       : (now|to_ms)
          }
        } as $session
      }
    }

    precondition ($session != null && $session.id != null) {
      error_type = "server"
      error = "session_init_failed"
    }

    // ── 2. Resolve job + tech + customer for brain context ──
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error = "job_not_found"
    }

    db.get technicians {
      field_name = "id"
      field_value = $input.technician_id
    } as $tech

    var $tech_first {
      value = (($tech.first_name ?? "")|to_text)|trim
    }

    var $brand_main {
      value = (($job.brand ?? "")|to_text)|trim
    }

    var $brand_vapi {
      value = (($job.appliance_brand ?? "")|to_text)|trim
    }

    var $brand_for_brain {
      value = ($brand_main != "") ? $brand_main : (($brand_vapi != "") ? $brand_vapi : "")
    }

    var $appliance_for_brain {
      value = (($job.appliance_type ?? "")|to_text)|trim
    }

    var $problem_for_brain {
      value = (($job.problem_summary ?? "")|to_text)|trim
    }

    var $customer_id_for_brain {
      value = ($job.customer_id ?? 0)
    }

    var $existing_captured {
      value = ($session.captured_data ?? {})
    }

    // ── 3. Resolve attachments → signed image URLs (vision) ──
    var $attachment_ids_in {
      value = ($input.attachment_ids ?? [])
    }

    var $attachment_count {
      value = $attachment_ids_in|count
    }

    var $image_s3_keys {
      value = []
    }

    conditional {
      if ($attachment_count > 0) {
        foreach ($attachment_ids_in) {
          each as $att_id {
            db.get job_attachments {
              field_name = "id"
              field_value = $att_id
            } as $att

            conditional {
              if ($att != null) {
                var $att_ft {
                  value = (($att.file_type ?? "")|to_text)
                }

                var $att_key {
                  value = (($att.s3_key ?? "")|to_text)
                }

                conditional {
                  if (($att_ft == "image" || $att_ft == "photo") && $att_key != "") {
                    array.push $image_s3_keys {
                      value = $att_key
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    var $media_urls {
      value = []
    }

    var $image_key_count {
      value = $image_s3_keys|count
    }

    conditional {
      if ($image_key_count > 0) {
        api.request {
          url = "https://superlative-naiad-233aa7.netlify.app/.netlify/functions/s3-view-url"
          method = "POST"
          params = {s3_keys: $image_s3_keys}
          headers = ["Content-Type: application/json"]
          timeout = 30
        } as $sign_resp

        var $signed_list {
          value = ($sign_resp.response.result.signed_urls ?? [])
        }

        foreach ($signed_list) {
          each as $sg {
            var $url_only {
              value = (($sg.view_url ?? "")|to_text)
            }

            conditional {
              if ($url_only != "") {
                array.push $media_urls {
                  value = $url_only
                }
              }
            }
          }
        }
      }
    }

    // ── 4. Call tech-assist-brain (scribe-mode) ──
    api.request {
      url = "https://tnapplianceexchange.net/.netlify/functions/tech-assist-brain"
      method = "POST"
      params = {
        tech_id          : $input.technician_id
        tech_first_name  : $tech_first
        job_id           : $input.job_id
        customer_id      : $customer_id_for_brain
        brand            : $brand_for_brain
        appliance        : $appliance_for_brain
        problem          : $problem_for_brain
        message          : $input.user_message
        media_urls       : $media_urls
        existing_captured: $existing_captured
      }
      headers = ["content-type: application/json"]
      timeout = 40
    } as $brain_resp

    var $chat_status {
      value = ($brain_resp.response.status ?? 0)
    }

    var $brain_result {
      value = ($brain_resp.response.result ?? {})
    }

    var $reply_text {
      value = (($brain_result.reply ?? "")|to_text)|trim
    }

    var $new_captured {
      value = ($brain_result.captured ?? {})
    }

    // ── 5. Merge new_captured onto existing (non-empty wins) ──
    var $merged_captured {
      value = $existing_captured
    }

    var $nc_diag {
      value = (($new_captured.diagnosis ?? "")|to_text)|trim
    }

    conditional {
      if ($nc_diag != "") {
        var.update $merged_captured {
          value = $merged_captured|set:"diagnosis":$nc_diag
        }
      }
    }

    var $nc_comp {
      value = (($new_captured.failed_component ?? "")|to_text)|trim
    }

    conditional {
      if ($nc_comp != "") {
        var.update $merged_captured {
          value = $merged_captured|set:"failed_component":$nc_comp
        }
      }
    }

    var $nc_cause {
      value = (($new_captured.failure_cause ?? "")|to_text)|trim
    }

    conditional {
      if ($nc_cause != "") {
        var.update $merged_captured {
          value = $merged_captured|set:"failure_cause":$nc_cause
        }
      }
    }

    var $nc_labor {
      value = (($new_captured.labor_hours ?? "")|to_text)|trim
    }

    conditional {
      if ($nc_labor != "") {
        var.update $merged_captured {
          value = $merged_captured|set:"labor_hours":$nc_labor
        }
      }
    }

    var $nc_repair {
      value = (($new_captured.repair_completed ?? "")|to_text)|trim
    }

    conditional {
      if ($nc_repair != "") {
        var.update $merged_captured {
          value = $merged_captured|set:"repair_completed":$nc_repair
        }
      }
    }

    var $nc_part {
      value = (($new_captured.verified_part_number ?? "")|to_text)|trim
    }

    conditional {
      if ($nc_part != "") {
        var.update $merged_captured {
          value = $merged_captured|set:"verified_part_number":$nc_part
        }
      }
    }

    var $nc_model {
      value = (($new_captured.model_number ?? "")|to_text)|trim
    }

    conditional {
      if ($nc_model != "") {
        var.update $merged_captured {
          value = $merged_captured|set:"model_number":$nc_model
        }
      }
    }

    var $nc_serial {
      value = (($new_captured.serial_number ?? "")|to_text)|trim
    }

    conditional {
      if ($nc_serial != "") {
        var.update $merged_captured {
          value = $merged_captured|set:"serial_number":$nc_serial
        }
      }
    }

    var $nc_parts_status {
      value = (($new_captured.parts_status ?? "")|to_text)|trim
    }

    conditional {
      if ($nc_parts_status != "") {
        var.update $merged_captured {
          value = $merged_captured|set:"parts_status":$nc_parts_status
        }
      }
    }

    // ── 6. Persist merged captured back to session ──
    db.edit tech_assist_session {
      field_name = "id"
      field_value = $session.id
      data = {
        captured_data: $merged_captured
        last_message_at: (now|to_ms)
      }
    }

    // ── 7. Audit row — what brain returned + which captured fields advanced ──
    db.add event_log {
      data = {
        action  : "tech_assist_chat_v2_call"
        metadata: {
          job_id      : $input.job_id
          tech_id     : $input.technician_id
          session_id  : $session.id
          chat_status : $chat_status
          reply_len   : $reply_text|strlen
          new_captured: $new_captured
          tool_calls  : ($brain_result.tool_calls ?? [])
          error       : ($brain_result.error ?? null)
        }
      }
    }
  }

  response = {
    success      : true
    reply        : $reply_text
    session_id   : $session.id
    captured_data: $merged_captured
  }

  guid = "tech-assist-chat-v2-scribe-mode"
}
