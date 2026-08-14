// Tech Ant Assist live in-field chat handler. Phase 1b. Model claude-sonnet-4-5-20250929.
// Sister of chat/reply2 but tech-oriented: anchored to a tech_assist_session,
// reads $env.ANT_TECH_ASSIST_PROMPT, parses paired tokens (__QUERY_STATUS__,
// __ESCALATE_TO_OFFICE__, __SEND_CUSTOMER_MESSAGE__), strips them from the
// user-visible reply, dispatches their effects, persists user + assistant messages
// with source="tech_assist". See docs/ant-tech-assist-design-v1.md.
query tech_assist_chat verb=POST {
  api_group = "intake"

  input {
    int job_id
    int technician_id
    text user_message filters=trim
    int? session_id?
    json? attachment_ids?
  
    // Per-vendor warranty checklist (fetched by the frontend via
    // /.netlify/functions/get-warranty-requirements). When present,
    // appended to the system prompt so Ant leads the tech through the
    // EXACT items this warranty company needs. Optional — when missing,
    // brain falls back to generic scribe behavior.
    text? warranty_checklist_text?
  }

  stack {
    // ── 1. Resolve session ──
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
        // Lazy-create the session inline. The original creation path
        // (start_tech_assist_session, called by hcp_job_webhook) is
        // disabled in parallel mode (HCP_WEBHOOK_DISABLED=true), so no
        // session row ever gets created and every chat message would
        // fail. Field shape mirrors start_tech_assist_session_POST.xs
        // lines 189-201 so the row is identical to one HCP-created.
        // The agent_conversation null-check downstream in this same
        // file self-heals the conversation row, so we only need the
        // session here.
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
      
        var $lazy_required_fields {
          value = [
            "model_confirmation"
            "symptom_confirmation"
            "diagnosis"
            "repair_completed_status"
          ]
        }
      
        db.add tech_assist_session {
          data = {
            job_id                   : $input.job_id
            technician_id            : $input.technician_id
            warranty_company         : $lazy_warranty_co
            customer_type            : $lazy_cust_type
            status                   : "active"
            captured_data            : {}
            required_fields_remaining: $lazy_required_fields
            session_start_event      : "lazy_created_by_chat"
            last_message_at          : now
            updated_at               : now
          }
        } as $session
      
        db.add event_log {
          data = {
            action  : "tech_assist_session_lazy_created"
            metadata: {
            session_id   : $session.id
            job_id       : $input.job_id
            technician_id: $input.technician_id
            source       : "tech_assist_chat_lazy"
          }
          }
        } as $lazy_audit
      }
    }
  
    // ── 2. Load job, tech, customer for CONTEXT ──
    db.get jobs {
      field_name = "id"
      field_value = $session.job_id
    } as $job
  
    db.get technicians {
      field_name = "id"
      field_value = $session.technician_id
    } as $tech
  
    var $customer {
      value = null
    }
  
    conditional {
      if ($job.customer_id != null && $job.customer_id > 0) {
        db.get customer {
          field_name = "id"
          field_value = $job.customer_id
        } as $customer
      }
    }
  
    // ── 3. Find conversation (by assist_session_id) ──
    db.query agent_conversation {
      where = $db.agent_conversation.assist_session_id == $session.id
      return = {type: "single"}
    } as $conversation
  
    conditional {
      if ($conversation == null) {
        // Shouldn't happen if start_tech_assist_session ran, but be defensive.
        db.add agent_conversation {
          data = {
            tech_id          : $session.technician_id
            channel          : "sms"
            title            : "Tech Assist - Job " ~ ($session.job_id|to_text)
            last_message_at  : "now"
            assist_session_id: $session.id
          }
        } as $conversation
      }
    }
  
    // ── 4. Pull recent messages (last 20, sort asc for prompt) ──
    db.query agent_message {
      where = $db.agent_message.conversation_id == $conversation.id
      sort = {agent_message.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 20}}
    } as $recent_desc
  
    var $recent {
      value = $recent_desc.items|reverse
    }
  
    // ── 5. Persist user message FIRST so it's durable even if Anthropic fails ──
    db.add agent_message {
      data = {
        conversation_id: $conversation.id
        role           : "user"
        content        : $input.user_message
        source         : "tech_assist"
      }
    } as $new_user_msg
  
    // ── 6. Build claude_messages (filter empty, dedupe consecutive same-role) ──
    var $claude_messages {
      value = []
    }
  
    var $last_pushed_role {
      value = ""
    }
  
    foreach ($recent) {
      each as $m {
        var $m_role {
          value = $m.role
        }
      
        var $m_content_raw {
          value = $m.content
        }
      
        var $m_content_str {
          value = ($m_content_raw == null) ? "" : ($m_content_raw|to_text)
        }
      
        var $m_content_trim {
          value = $m_content_str|trim
        }
      
        conditional {
          if (($m_content_trim != "") && ($m_role != $last_pushed_role)) {
            array.push $claude_messages {
              value = {role: $m_role, content: $m_content_raw}
            }
          
            var.update $last_pushed_role {
              value = $m_role
            }
          }
        }
      }
    }
  
    // ── 6b. Vision integration — collect image view URLs for the
    // attachments the client just uploaded. Mirrors the pattern used in
    // qc_cockpit_load (s3-view-url Netlify function) and the message
    // shape Anthropic accepts (same as tech-assist-brain.js for SMS):
    // { type: "image", source: { type: "url", url: <signed_url> } }
    // Only image attachments are sent to vision; videos are skipped
    // (Claude does not accept video frames as input today).
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
                  value = ($att.file_type ?? "")|to_text
                }
              
                var $att_key {
                  value = ($att.s3_key ?? "")|to_text
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
  
    var $image_view_urls {
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
        } as $sign_resp_chat
      
        var $signed_chat {
          value = ($sign_resp_chat.response.result.signed_urls ?? [])
        }
      
        foreach ($signed_chat) {
          each as $sg2 {
            var $url_only {
              value = ($sg2.view_url ?? "")|to_text
            }
          
            conditional {
              if ($url_only != "") {
                array.push $image_view_urls {
                  value = $url_only
                }
              }
            }
          }
        }
      }
    }
  
    // The just-persisted user message is NOT in $recent (querying happened before
    // the insert). Always append it as the latest user turn. If history's last
    // pushed role was already "user" (rare double-tap), Anthropic will combine.
    // With images, the content is an array of [image blocks..., text block].
    // Without images, the content stays a plain string (unchanged behavior).
    var $final_image_count {
      value = $image_view_urls|count
    }
  
    conditional {
      if ($final_image_count > 0) {
        var $user_content_blocks {
          value = []
        }
      
        foreach ($image_view_urls) {
          each as $iurl {
            array.push $user_content_blocks {
              value = {type: "image", source: {type: "url", url: $iurl}}
            }
          }
        }
      
        array.push $user_content_blocks {
          value = {type: "text", text: $input.user_message}
        }
      
        array.push $claude_messages {
          value = {role: "user", content: $user_content_blocks}
        }
      }
    
      else {
        array.push $claude_messages {
          value = {role: "user", content: $input.user_message}
        }
      }
    }
  
    // ── 7. Build 7-day calendar (same pattern as tech_sms_inbound) ──
    var $today_ct_ts {
      value = now|transform_timestamp:"-5 hours"
    }
  
    var $today_date_str {
      value = $today_ct_ts|format_timestamp:"Y-m-d"
    }
  
    var $today_day_str {
      value = $today_ct_ts|format_timestamp:"l"
    }
  
    var $d1_ts {
      value = $today_ct_ts|transform_timestamp:"+1 days"
    }
  
    var $d1_date {
      value = $d1_ts|format_timestamp:"Y-m-d"
    }
  
    var $d1_day {
      value = $d1_ts|format_timestamp:"l"
    }
  
    var $d2_ts {
      value = $today_ct_ts|transform_timestamp:"+2 days"
    }
  
    var $d2_date {
      value = $d2_ts|format_timestamp:"Y-m-d"
    }
  
    var $d2_day {
      value = $d2_ts|format_timestamp:"l"
    }
  
    var $d3_ts {
      value = $today_ct_ts|transform_timestamp:"+3 days"
    }
  
    var $d3_date {
      value = $d3_ts|format_timestamp:"Y-m-d"
    }
  
    var $d3_day {
      value = $d3_ts|format_timestamp:"l"
    }
  
    var $d4_ts {
      value = $today_ct_ts|transform_timestamp:"+4 days"
    }
  
    var $d4_date {
      value = $d4_ts|format_timestamp:"Y-m-d"
    }
  
    var $d4_day {
      value = $d4_ts|format_timestamp:"l"
    }
  
    var $d5_ts {
      value = $today_ct_ts|transform_timestamp:"+5 days"
    }
  
    var $d5_date {
      value = $d5_ts|format_timestamp:"Y-m-d"
    }
  
    var $d5_day {
      value = $d5_ts|format_timestamp:"l"
    }
  
    var $d6_ts {
      value = $today_ct_ts|transform_timestamp:"+6 days"
    }
  
    var $d6_date {
      value = $d6_ts|format_timestamp:"Y-m-d"
    }
  
    var $d6_day {
      value = $d6_ts|format_timestamp:"l"
    }
  
    var $d7_ts {
      value = $today_ct_ts|transform_timestamp:"+7 days"
    }
  
    var $d7_date {
      value = $d7_ts|format_timestamp:"Y-m-d"
    }
  
    var $d7_day {
      value = $d7_ts|format_timestamp:"l"
    }
  
    var $calendar_text {
      value = "\nTomorrow: " ~ $d1_date ~ " (" ~ $d1_day ~ ")\n" ~ $d2_day ~ ": " ~ $d2_date ~ "\n" ~ $d3_day ~ ": " ~ $d3_date ~ "\n" ~ $d4_day ~ ": " ~ $d4_date ~ "\n" ~ $d5_day ~ ": " ~ $d5_date ~ "\n" ~ $d6_day ~ ": " ~ $d6_date ~ "\nNext " ~ $d7_day ~ ": " ~ $d7_date
    }
  
    // ── 8. Build CONTEXT block ──
    var $tech_first_str {
      value = ($tech.first_name ?? "")|trim
    }
  
    var $tech_id_str {
      value = $tech.id|to_text
    }
  
    var $session_id_str {
      value = $session.id|to_text
    }
  
    var $job_id_str {
      value = $session.job_id|to_text
    }
  
    var $warranty_co_str {
      value = ($session.warranty_company ?? "")|trim
    }
  
    // Customer name with preferred fallback.
    var $cust_pref_raw {
      value = ($customer.preferred_name ?? "")|trim
    }
  
    var $cust_first_raw {
      value = ($customer.first_name ?? "")|trim
    }
  
    var $cust_display_name {
      value = ($cust_pref_raw != "") ? $cust_pref_raw : (($cust_first_raw != "") ? $cust_first_raw : "(no customer)")
    }
  
    // Brand/type/model with main-then-vapi fallback.
    var $brand_main {
      value = ($job.brand ?? "")|trim
    }
  
    var $brand_vapi {
      value = ($job.appliance_brand ?? "")|trim
    }
  
    var $brand_for_ctx {
      value = ($brand_main != "") ? $brand_main : (($brand_vapi != "") ? $brand_vapi : "(unknown)")
    }
  
    var $appliance_type_for_ctx {
      value = ($job.appliance_type ?? "")|trim
    }
  
    var $appliance_type_disp {
      value = ($appliance_type_for_ctx != "") ? $appliance_type_for_ctx : "(unknown)"
    }
  
    var $model_main {
      value = ($job.model_number ?? "")|trim
    }
  
    var $model_vapi {
      value = ($job.appliance_model ?? "")|trim
    }
  
    var $model_for_ctx {
      value = ($model_main != "") ? $model_main : (($model_vapi != "") ? $model_vapi : "(none on file)")
    }
  
    // captured_data + required_fields json-encoded.
    var $captured_json {
      value = ($session.captured_data ?? {})|json_encode
    }
  
    var $required_json {
      value = ($session.required_fields_remaining ?? [])|json_encode
    }
  
    // Per-vendor warranty checklist block — appended only when the
    // frontend supplied one. Tells Ant exactly what THIS warranty
    // company needs and which items are already captured.
    var $checklist_raw {
      value = (($input.warranty_checklist_text ?? "")|trim)
    }
  
    var $warranty_block {
      value = ($checklist_raw != "") ? ("\n\n# WARRANTY-SPECIFIC REQUIREMENTS\n\n" ~ $checklist_raw ~ "\n\nLEAD THE TECH THROUGH THESE IN ORDER. Confirm each captured item without re-asking. Ask for the next pending item using its prompt text. When ALL required items are captured, say 'TDR ready — tap save.' and stop asking.\n") : ""
    }
  
    // VISION OVERRIDE 2026-05-29: vision IS now wired (this endpoint
    // ships image blocks via attachment_ids → s3-view-url → Claude
    // image source). Older versions of ANT_TECH_ASSIST_PROMPT told
    // Claude "I can't see photos yet" which contradicts current
    // behavior. Append an override note whenever images are attached
    // so Claude knows to actually analyze them and extract any
    // visible model / serial / part / error code text.
    var $vision_note {
      value = ($final_image_count > 0) ? "\n\n# VISION ENABLED THIS TURN\n\nThe tech attached " ~ ($final_image_count|to_text) ~ " image(s) to this message. You CAN see them. Read any visible model number / serial / part number / error code / nameplate text and confirm it back to the tech. If it is a model or serial plate, capture the model and serial as TDR fields. Do not say you cannot see images." : ""
    }
  
    var $context_block {
      value = "\n\n# CURRENT CONTEXT\n\nToday: " ~ $today_date_str ~ " (" ~ $today_day_str ~ ") - Central Time" ~ $calendar_text ~ "\n\nSession: id=" ~ $session_id_str ~ ", job_id=" ~ $job_id_str ~ "\nTech: " ~ $tech_first_str ~ " (tech_id=" ~ $tech_id_str ~ ")\nWarranty company: " ~ $warranty_co_str ~ "\nCustomer: " ~ $cust_display_name ~ "\nAppliance: " ~ $brand_for_ctx ~ " " ~ $appliance_type_disp ~ " (model: " ~ $model_for_ctx ~ ")\n\nCAPTURED SO FAR (json): " ~ $captured_json ~ "\nREQUIRED FIELDS REMAINING (json): " ~ $required_json ~ $warranty_block ~ $vision_note
    }
  
    // ── 9. Call Anthropic ──
    api.request {
      url = "https://api.anthropic.com/v1/messages"
      method = "POST"
      params = {
        model     : "claude-sonnet-4-5-20250929"
        max_tokens: 1024
        system    : ($env.ANT_TECH_ASSIST_PROMPT ~ $context_block)
        messages  : $claude_messages
      }
    
      headers = [
        "x-api-key: " ~ $env.ANTHROPIC_API_KEY
        "anthropic-version: 2023-06-01"
        "content-type: application/json"
      ]
    
      timeout = 40
    } as $claude_response
  
    var $reply_text {
      value = $claude_response.response.result.content[0].text
    }
  
    var $clean_reply {
      value = $reply_text
    }
  
    // ── 10. Token dispatch + strip ──
  
    // 10z. __CAPTURE_FIELD__ FIRST so __QUERY_STATUS__ below reflects updated state.
    // Token shape: __CAPTURE_FIELD__ name="key" value="val" __END_CAPTURE_FIELD__.
    // Multiple per reply allowed. Embedded double-quotes in value are not supported -
    // the prompt instructs Claude to avoid them; if one slips through we truncate at
    // the first inner quote (acceptable for v1c placeholder data).
    var $new_captured {
      value = $session.captured_data ?? {}
    }
  
    // Track captured names so we can rebuild required_fields_remaining after
    // the parse loop. Inline `|filter:$this != $dynamic_var` does NOT bind the
    // outer-scope var inside the filter closure (footgun: works only with
    // literal-string args). Manual nested-foreach below is the workaround.
    var $captured_names {
      value = []
    }
  
    var $captures_made {
      value = false
    }
  
    conditional {
      if ($clean_reply|contains:"__CAPTURE_FIELD__") {
        var $cf_parts {
          value = $clean_reply|split:"__CAPTURE_FIELD__"
        }
      
        var $clean_reply_post_capture {
          value = ""
        }
      
        var $cf_first_done {
          value = false
        }
      
        foreach ($cf_parts) {
          each as $cf_part {
            conditional {
              if ($cf_first_done == false) {
                var.update $clean_reply_post_capture {
                  value = $cf_part
                }
              
                var.update $cf_first_done {
                  value = true
                }
              }
            
              else {
                conditional {
                  if ($cf_part|contains:"__END_CAPTURE_FIELD__") {
                    var $cf_end_split {
                      value = $cf_part|split:"__END_CAPTURE_FIELD__"
                    }
                  
                    var $cf_inner {
                      value = `($cf_end_split|get:0)|trim`
                    }
                  
                    var $cf_post {
                      value = $cf_end_split|get:1
                    }
                  
                    // Parse name="..."
                    var $cf_name_split {
                      value = $cf_inner|split:'name="'
                    }
                  
                    var $cf_field_name {
                      value = ""
                    }
                  
                    conditional {
                      if (($cf_name_split|count) >= 2) {
                        var $cf_name_after {
                          value = $cf_name_split|get:1
                        }
                      
                        var $cf_name_close {
                          value = $cf_name_after|split:'"'
                        }
                      
                        var.update $cf_field_name {
                          value = `($cf_name_close|get:0)|trim`
                        }
                      }
                    }
                  
                    // Parse value="..."
                    var $cf_val_split {
                      value = $cf_inner|split:'value="'
                    }
                  
                    var $cf_field_value {
                      value = ""
                    }
                  
                    conditional {
                      if (($cf_val_split|count) >= 2) {
                        var $cf_val_after {
                          value = $cf_val_split|get:1
                        }
                      
                        var $cf_val_close {
                          value = $cf_val_after|split:'"'
                        }
                      
                        var.update $cf_field_value {
                          value = `($cf_val_close|get:0)|trim`
                        }
                      }
                    }
                  
                    conditional {
                      if ($cf_field_name != "") {
                        var.update $new_captured {
                          value = $new_captured
                            |set:$cf_field_name:$cf_field_value
                        }
                      
                        array.push $captured_names {
                          value = $cf_field_name
                        }
                      
                        var.update $captures_made {
                          value = true
                        }
                      
                        db.add event_log {
                          data = {
                            action  : "tech_assist_field_captured"
                            metadata: {
                            session_id : $session.id
                            field_name : $cf_field_name
                            field_value: $cf_field_value
                          }
                          }
                        } as $cap_log
                      }
                    }
                  
                    var.update $clean_reply_post_capture {
                      value = $clean_reply_post_capture ~ $cf_post
                    }
                  }
                
                  else {
                    // Malformed (no closing). Preserve as-is in the visible reply.
                    var.update $clean_reply_post_capture {
                      value = $clean_reply_post_capture ~ "__CAPTURE_FIELD__" ~ $cf_part
                    }
                  }
                }
              }
            }
          }
        }
      
        var.update $clean_reply {
          value = $clean_reply_post_capture
        }
      }
    }
  
    // Build new required_fields_remaining by walking the existing list and
    // dropping any name that matches one we just captured. Manual filter
    // (see footgun note above on the broken |filter dynamic-arg path).
    var $new_required {
      value = []
    }
  
    foreach ($session.required_fields_remaining ?? []) {
      each as $rf {
        var $rf_was_captured {
          value = false
        }
      
        foreach ($captured_names) {
          each as $cn {
            conditional {
              if ($cn == $rf) {
                var.update $rf_was_captured {
                  value = true
                }
              }
            }
          }
        }
      
        conditional {
          if ($rf_was_captured == false) {
            array.push $new_required {
              value = $rf
            }
          }
        }
      }
    }
  
    // Persist captures + refresh json strings used by __QUERY_STATUS__ below.
    conditional {
      if ($captures_made) {
        db.edit tech_assist_session {
          field_name = "id"
          field_value = $session.id
          data = {
            captured_data            : $new_captured
            required_fields_remaining: $new_required
            last_message_at          : now
            updated_at               : now
          }
        } as $session_after_capture
      
        var.update $captured_json {
          value = $new_captured|json_encode
        }
      
        var.update $required_json {
          value = $new_required|json_encode
        }
      }
    }
  
    // 10a. __QUERY_STATUS__: append captured-data summary, strip both forms.
    conditional {
      if ($clean_reply|contains:"__QUERY_STATUS__") {
        var $status_block {
          value = "\n\n📊 captured: " ~ $captured_json ~ "\n📋 still needed: " ~ $required_json
        }
      
        var $qs_parts {
          value = $clean_reply|split:"__QUERY_STATUS__"
        }
      
        conditional {
          if (($qs_parts|count) >= 3) {
            var.update $clean_reply {
              value = `($qs_parts|get:0) ~ ($qs_parts|get:2) ~ $status_block`
            }
          }
        
          else {
            // Bare token form. Strip both __END_X__ first then bare __X__ (footgun #9).
            var $stripped_a {
              value = $clean_reply
                |replace:"__END_QUERY_STATUS__":""
            }
          
            var $stripped_b {
              value = $stripped_a|replace:"__QUERY_STATUS__":""
            }
          
            var.update $clean_reply {
              value = $stripped_b ~ $status_block
            }
          }
        }
      
        // Strip any stray __END__ that survived the paired path.
        var.update $clean_reply {
          value = $clean_reply
            |replace:"__END_QUERY_STATUS__":""
        }
      
        db.add event_log {
          data = {
            action  : "tech_assist_query_status_fired"
            metadata: {session_id: $session.id}
          }
        } as $qs_log
      }
    }
  
    // 10b. __ESCALATE_TO_OFFICE__: real SMS to OWNER_PHONE_NUMBER (placeholder
    // until DANIELLE_PHONE env var is added). Strip token from user-visible reply.
    // Token form is paired-with-different-end-marker (__OPEN__ inner __END_OPEN__),
    // so outer-split on opening yields 2 parts (NOT 3), then sub-split [1] on
    // __END_OPEN__ to get [inner, post-prose].
    conditional {
      if ($clean_reply|contains:"__ESCALATE_TO_OFFICE__") {
        var $esc_parts {
          value = $clean_reply|split:"__ESCALATE_TO_OFFICE__"
        }
      
        var $esc_pre {
          value = `($esc_parts|count) >= 1 ? ($esc_parts|get:0) : $clean_reply`
        }
      
        var $esc_inner {
          value = ""
        }
      
        var $esc_post {
          value = ""
        }
      
        conditional {
          if (($esc_parts|count) >= 2) {
            var $esc_after_open {
              value = $esc_parts|get:1
            }
          
            conditional {
              if ($esc_after_open|contains:"__END_ESCALATE_TO_OFFICE__") {
                var $esc_end_split {
                  value = $esc_after_open
                    |split:"__END_ESCALATE_TO_OFFICE__"
                }
              
                var.update $esc_inner {
                  value = `($esc_end_split|get:0)|trim`
                }
              
                var.update $esc_post {
                  value = $esc_end_split|get:1
                }
              }
            
              else {
                var.update $esc_inner {
                  value = $esc_after_open|trim
                }
              }
            }
          }
        }
      
        var $esc_sms_body {
          value = "tech ant escalation from " ~ $tech_first_str ~ ": " ~ $esc_inner
        }
      
        var $esc_action {
          value = "tech_assist_escalation_failed"
        }
      
        conditional {
          if (($env.OWNER_PHONE_NUMBER ? "" : ) != "") {
            // ── SMS_ENABLED gate (call_site: tech_assist_chat_POST.xs:629) ──
            var $gate629_recipient_e164 {
              value = ($env.OWNER_PHONE_NUMBER ?? "")|trim
            }
          
            var $gate629_recipient_bare {
              value = $gate629_recipient_e164|replace:"+1":""
            }
          
            var $gate629_is_owner {
              value = ($gate629_recipient_e164 == "+16154855795") || ($gate629_recipient_bare == "6154855795")
            }
          
            var $gate629_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate629_should_send {
              value = $gate629_sms_enabled || $gate629_is_owner
            }
          
            conditional {
              if ($gate629_should_send == false) {
                db.add event_log {
                  data = {
                    action  : "sms_gated"
                    metadata: {
                    recipient   : $gate629_recipient_e164
                    body_preview: $esc_sms_body|substr:0:200
                    gated_reason: "SMS_ENABLED=false, non-owner recipient"
                    call_site   : "tech_assist_chat_POST.xs:629"
                    session_id  : $session.id
                  }
                  }
                } as $gate629_log
              }
            
              else {
                conditional {
                  if ($gate629_is_owner && $gate629_sms_enabled == false) {
                    db.add event_log {
                      data = {
                        action  : "sms_owner_bypass"
                        metadata: {
                        recipient   : $gate629_recipient_e164
                        body_preview: $esc_sms_body|substr:0:200
                        call_site   : "tech_assist_chat_POST.xs:629"
                        session_id  : $session.id
                      }
                      }
                    } as $bypass629_log
                  }
                }
              
                api.request {
                  url = "https://api.telnyx.com/v2/messages"
                  method = "POST"
                  params = {
                    from: $env.TELNYX_FROM_TECH
                    to  : "+16154850713"
                    text: $esc_sms_body
                  }
                
                  headers = [
                    "Authorization: Bearer " ~ $env.TELNYX_API_KEY
                    "Content-Type: application/json"
                  ]
                } as $esc_resp
              
                conditional {
                  if (($esc_resp.response.status == 201) || ($esc_resp.response.status == 200)) {
                    var.update $esc_action {
                      value = "tech_assist_escalation_sent"
                    }
                  }
                }
              }
            }
          }
        }
      
        db.add event_log {
          data = {
            action  : $esc_action
            metadata: {
            session_id : $session.id
            tech_id    : $session.technician_id
            job_id     : $session.job_id
            token_inner: $esc_inner
          }
          }
        } as $esc_log
      
        var.update $clean_reply {
          value = $esc_pre ~ $esc_post
        }
      }
    }
  
    // 10c. __SEND_CUSTOMER_MESSAGE__: parse template_id, build templated body,
    // send via Twilio to customer.phone, persist outbound to customer's
    // agent_conversation. Hardcoded template switch is a placeholder until a
    // template management table exists (Phase 1d follow-up). Same paired-with-
    // different-end-marker parse as __ESCALATE_TO_OFFICE__.
    conditional {
      if ($clean_reply|contains:"__SEND_CUSTOMER_MESSAGE__") {
        var $cm_parts {
          value = $clean_reply
            |split:"__SEND_CUSTOMER_MESSAGE__"
        }
      
        var $cm_pre {
          value = `($cm_parts|count) >= 1 ? ($cm_parts|get:0) : $clean_reply`
        }
      
        var $cm_inner {
          value = ""
        }
      
        var $cm_post {
          value = ""
        }
      
        conditional {
          if (($cm_parts|count) >= 2) {
            var $cm_after_open {
              value = $cm_parts|get:1
            }
          
            conditional {
              if ($cm_after_open|contains:"__END_SEND_CUSTOMER_MESSAGE__") {
                var $cm_end_split {
                  value = $cm_after_open
                    |split:"__END_SEND_CUSTOMER_MESSAGE__"
                }
              
                var.update $cm_inner {
                  value = `($cm_end_split|get:0)|trim`
                }
              
                var.update $cm_post {
                  value = $cm_end_split|get:1
                }
              }
            
              else {
                var.update $cm_inner {
                  value = $cm_after_open|trim
                }
              }
            }
          }
        }
      
        // Parse template_id="..."
        var $cm_tid_split {
          value = $cm_inner|split:'template_id="'
        }
      
        var $cm_template_id {
          value = ""
        }
      
        conditional {
          if (($cm_tid_split|count) >= 2) {
            var $cm_tid_after {
              value = $cm_tid_split|get:1
            }
          
            var $cm_tid_close {
              value = $cm_tid_after|split:'"'
            }
          
            var.update $cm_template_id {
              value = `($cm_tid_close|get:0)|trim`
            }
          }
        }
      
        // Resolve customer-facing variables.
        var $tpl_appliance {
          value = ($appliance_type_for_ctx != "") ? $appliance_type_for_ctx : "appliance"
        }
      
        var $tpl_preferred {
          value = $cust_display_name
        }
      
        var $tpl_tech_first {
          value = ($tech_first_str != "") ? ($tech_first_str|to_lower) : "your tech"
        }
      
        // Hardcoded template switch (Phase 1c placeholder).
        var $cm_body {
          value = ""
        }
      
        conditional {
          if ($cm_template_id == "just_arrived") {
            var.update $cm_body {
              value = "hi " ~ $tpl_preferred ~ " - tn appliance here, your tech " ~ $tpl_tech_first ~ " just pulled up. coming to the door now."
            }
          }
        
          elseif ($cm_template_id == "diagnosis_complete") {
            var.update $cm_body {
              value = "hi " ~ $tpl_preferred ~ " - " ~ $tpl_tech_first ~ " finished checking out your " ~ $tpl_appliance ~ ". office will follow up shortly with what we found and next steps."
            }
          }
        
          elseif ($cm_template_id == "starting_repair") {
            var.update $cm_body {
              value = "hi " ~ $tpl_preferred ~ " - " ~ $tpl_tech_first ~ " is starting the repair on your " ~ $tpl_appliance ~ " now. should have it sorted shortly."
            }
          }
        
          elseif ($cm_template_id == "wrapping_up") {
            var.update $cm_body {
              value = "hi " ~ $tpl_preferred ~ " - " ~ $tpl_tech_first ~ " is wrapping up and needs a quick signature before he heads out. come find him when you get a sec, thanks!"
            }
          }
        
          elseif ($cm_template_id == "repair_complete") {
            var.update $cm_body {
              value = "hi " ~ $tpl_preferred ~ " - " ~ $tpl_tech_first ~ " finished the repair on your " ~ $tpl_appliance ~ ". it's back up and running. office will send a summary shortly."
            }
          }
        
          elseif ($cm_template_id == "heading_out") {
            var.update $cm_body {
              value = "hi " ~ $tpl_preferred ~ " - " ~ $tpl_tech_first ~ " just headed out. thanks for choosing tn appliance today. youll get a feedback link from us shortly."
            }
          }
        }
      
        var $cm_action {
          value = "tech_assist_customer_msg_failed"
        }
      
        // Send + persist only if we have a known template AND a customer phone.
        var $cust_phone_raw {
          value = ($customer.phone ?? "")|trim
        }
      
        var $cust_phone_e164 {
          value = ($cust_phone_raw != "" && (($cust_phone_raw|starts_with:"+") == false)) ? ("+1" ~ $cust_phone_raw) : $cust_phone_raw
        }
      
        conditional {
          if ($cm_body != "" && $cust_phone_e164 != "") {
            // ── SMS_ENABLED gate (call_site: tech_assist_chat_POST.xs:805) ──
            var $gate805_recipient_e164 {
              value = $cust_phone_e164|trim
            }
          
            var $gate805_recipient_bare {
              value = $gate805_recipient_e164|replace:"+1":""
            }
          
            var $gate805_is_owner {
              value = ($gate805_recipient_e164 == "+16154855795") || ($gate805_recipient_bare == "6154855795")
            }
          
            var $gate805_sms_enabled {
              value = (($env.SMS_ENABLED ?? "false") == "true")
            }
          
            var $gate805_should_send {
              value = $gate805_sms_enabled || $gate805_is_owner
            }
          
            conditional {
              if ($gate805_should_send == false) {
                db.add event_log {
                  data = {
                    action  : "sms_gated"
                    metadata: {
                    recipient   : $gate805_recipient_e164
                    body_preview: $cm_body|substr:0:200
                    gated_reason: "SMS_ENABLED=false, non-owner recipient"
                    call_site   : "tech_assist_chat_POST.xs:805"
                    session_id  : $session.id
                    template_id : $cm_template_id
                  }
                  }
                } as $gate805_log
              }
            
              else {
                conditional {
                  if ($gate805_is_owner && $gate805_sms_enabled == false) {
                    db.add event_log {
                      data = {
                        action  : "sms_owner_bypass"
                        metadata: {
                        recipient   : $gate805_recipient_e164
                        body_preview: $cm_body|substr:0:200
                        call_site   : "tech_assist_chat_POST.xs:805"
                        session_id  : $session.id
                        template_id : $cm_template_id
                      }
                      }
                    } as $bypass805_log
                  }
                }
              
                api.request {
                  url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
                  method = "POST"
                  params = {
                    to         : $cust_phone_e164
                    message    : $cm_body
                    context_tag: "tech_assist_customer_msg"
                  }
                
                  headers = ["Content-Type: application/json"]
                  timeout = 30
                } as $cm_resp
              
                var $cm_send_ok {
                  value = (($cm_resp.response.result.success ?? false) == true)
                }

                conditional {
                  if ($cm_send_ok == true) {
                    var.update $cm_action {
                      value = "tech_assist_customer_msg_sent"
                    }
                  }
                }
              
                // Find or create customer's agent_conversation. v1: prefer most recent
                // by customer_id; create with channel="web" if none.
                db.query agent_conversation {
                  where = $db.agent_conversation.customer_id == $customer.id
                  sort = {agent_conversation.created_at: "desc"}
                  return = {type: "single"}
                } as $cust_conv
              
                conditional {
                  if ($cust_conv == null) {
                    db.add agent_conversation {
                      data = {
                        customer_id    : $customer.id
                        channel        : "web"
                        title          : "Customer thread"
                        last_message_at: "now"
                      }
                    } as $cust_conv
                  }
                }
              
                db.add agent_message {
                  data = {
                    conversation_id: $cust_conv.id
                    role           : "assistant"
                    content        : $cm_body
                    source         : "tech_assist"
                  }
                } as $cm_persisted
              
                db.edit agent_conversation {
                  field_name = "id"
                  field_value = $cust_conv.id
                  data = {last_message_at: "now"}
                } as $cm_conv_bumped
              }
            }
          }
        }
      
        db.add event_log {
          data = {
            action  : $cm_action
            metadata: {
            session_id : $session.id
            template_id: $cm_template_id
            token_inner: $cm_inner
          }
          }
        } as $cm_log
      
        var.update $clean_reply {
          value = $cm_pre ~ $cm_post
        }
      }
    }
  
    // Final cleanup: trim and fall back if Claude emitted only token blocks with empty prose.
    var.update $clean_reply {
      value = $clean_reply|trim
    }
  
    conditional {
      if ($clean_reply == "") {
        var.update $clean_reply {
          value = "got it"
        }
      }
    }
  
    // ── 11. Persist assistant reply + bump session/conversation timestamps ──
    db.add agent_message {
      data = {
        conversation_id: $conversation.id
        role           : "assistant"
        content        : $clean_reply
        source         : "tech_assist"
      }
    } as $new_assistant_msg
  
    db.edit tech_assist_session {
      field_name = "id"
      field_value = $session.id
      data = {last_message_at: now, updated_at: now}
    } as $updated_session
  
    db.edit agent_conversation {
      field_name = "id"
      field_value = $conversation.id
      data = {last_message_at: "now"}
    } as $updated_conv
  }

  response = {
    success      : true
    reply        : $clean_reply
    session_id   : $session.id
    captured_data: $session.captured_data
  }

  guid = "p_9mxKL6fc7OikYZN6Al3Qa6gLk"
}