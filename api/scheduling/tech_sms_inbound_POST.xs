//  Inbound SMS handler for Ant Tech Scheduler.
//  Receives { phone, body, sid, to } from netlify/functions/tech-sms-inbound.js.
//  Returns { reply: "..." } which Netlify wraps in TwiML for Twilio.
// 
//  Flow:
//    1. Phone lookup (E.164 exact, then last-10-digits fallback) → identify tech
//    2. Find-or-create agent_conversation (tech_id + channel='sms')
//    3. Persist user message
//    4. Mode select on tech.onboarding_completed_at
//    5a. Onboarding mode: Anthropic call + 5-token capture parser + action dispatch
//    5b. Daily mode (Phase 1 stub): canned holding reply (full Ant in Phase 5)
//    6. Persist assistant message + return reply
query tech_sms_inbound verb=POST {
  api_group = "scheduling"

  input {
    text phone filters=trim
    text body filters=trim
    text? sid?
    text? to?
  }

  stack {
    // ────────────────────────────────────────────────────────
    // 1. Phone lookup with E.164 + last-10-digits fallback.
    // ────────────────────────────────────────────────────────
    var $tech {
      value = null
    }
  
    db.query technicians {
      where = $db.technicians.phone == $input.phone
      return = {type: "single"}
    } as $tech_exact
  
    conditional {
      if ($tech_exact != null) {
        var.update $tech {
          value = $tech_exact
        }
      }
    
      else {
        // Fallback: Twilio sends E.164 ("+16154855795"); tech rows store bare 10-digit
        // ("6154855795"). Strip the "+1" prefix and match either form via SQL OR.
        // Note: assumes US numbers. Non-+1 country codes won't match.
        var $input_bare {
          value = $input.phone|replace:"+1":""
        }
      
        db.query technicians {
          where = $db.technicians.active == true && ($db.technicians.phone == $input.phone || $db.technicians.phone == $input_bare)
          return = {type: "single"}
        } as $tech_fallback
      
        conditional {
          if ($tech_fallback != null) {
            var.update $tech {
              value = $tech_fallback
            }
          }
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 2. Unknown number → polite redirect, no DB writes.
    // ────────────────────────────────────────────────────────
    conditional {
      if ($tech == null) {
        return {
          value = {
            reply: "this number isn't recognized as a tech. if you meant to text the company line about service, call 866-268-0111."
          }
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 3. Find or create the SMS conversation for this tech.
    // ────────────────────────────────────────────────────────
    var $conversation {
      value = null
    }
  
    db.query agent_conversation {
      where = $db.agent_conversation.tech_id == $tech.id && $db.agent_conversation.channel == "sms"
      sort = {agent_conversation.created_at: "desc"}
      return = {type: "single"}
    } as $existing_conv
  
    conditional {
      if ($existing_conv != null) {
        var.update $conversation {
          value = $existing_conv
        }
      }
    
      else {
        var $new_session_id {
          value = "tech_" ~ ($tech.id|to_text) ~ "_" ~ ((now|to_ms)|to_text)
        }
      
        db.add agent_conversation {
          data = {
            tech_id        : $tech.id
            channel        : "sms"
            title          : "Tech SMS"
            last_message_at: now
            session_id     : $new_session_id
          }
        } as $new_conv
      
        var.update $conversation {
          value = $new_conv
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 4. Persist user message.
    // ────────────────────────────────────────────────────────
    db.add agent_message {
      data = {
        conversation_id: $conversation.id
        role           : "user"
        content        : $input.body
      }
    } as $new_user_msg
  
    // ────────────────────────────────────────────────────────
    // 4b. PICK1 / PICK2 / PICK3 owner-pick handler (Phase 6 booking).
    // ────────────────────────────────────────────────────────
    // When scheduling_queue_worker.propose SMSes the owner three slot options
    // ("Reply PICK1/2/3..."), this short-circuits the Claude path and
    // applies the chosen option directly: sets jobs.scheduled_start,
    // technician_id, scheduling_status="scheduled" and marks the proposal's
    // broadcast_attempt status="booked". Scoped to tech_id=1 because propose
    // SMSes go to OWNER_PHONE_NUMBER only.
    conditional {
      if ($tech.id == 1) {
        var $body_norm {
          value = (($input.body ?? "")|trim)|to_lower
        }
      
        var $pick_index {
          value = 0
        }
      
        conditional {
          if (($body_norm == "pick1") || ($body_norm == "pick 1") || ($body_norm == "1")) {
            var.update $pick_index {
              value = 1
            }
          }
        
          elseif (($body_norm == "pick2") || ($body_norm == "pick 2") || ($body_norm == "2")) {
            var.update $pick_index {
              value = 2
            }
          }
        
          elseif (($body_norm == "pick3") || ($body_norm == "pick 3") || ($body_norm == "3")) {
            var.update $pick_index {
              value = 3
            }
          }
        }
      
        conditional {
          if ($pick_index > 0) {
            db.query broadcast_attempt {
              where = $db.broadcast_attempt.broadcast_type == "must_time_proposal" && $db.broadcast_attempt.status == "open"
              sort = {broadcast_attempt.created_at: "desc"}
              return = {type: "single"}
            } as $proposal
          
            conditional {
              if ($proposal == null) {
                return {
                  value = {
                    reply: "no open proposal to pick from. when one comes in i'll send the options."
                  }
                }
              }
            }
          
            var $options {
              value = ($proposal.techs_notified ?? [])
            }
          
            var $options_count {
              value = $options|count
            }
          
            var $picked {
              value = null
            }
          
            conditional {
              if (($pick_index == 1) && ($options_count >= 1)) {
                var.update $picked {
                  value = $options|get:0
                }
              }
            
              elseif (($pick_index == 2) && ($options_count >= 2)) {
                var.update $picked {
                  value = $options|get:1
                }
              }
            
              elseif (($pick_index == 3) && ($options_count >= 3)) {
                var.update $picked {
                  value = $options|get:2
                }
              }
            }
          
            conditional {
              if ($picked == null) {
                return {
                  value = {
                    reply: "that pick number doesn't match an option in the proposal. it had " ~ ($options_count|to_text) ~ " options."
                  }
                }
              }
            }
          
            var $picked_window {
              value = ($picked.window ?? "08:00 - 16:00")
            }
          
            var $window_parts {
              value = $picked_window|split:" - "
            }
          
            var $win_start_str {
              value = $window_parts|get:0
            }
          
            var $picked_date {
              value = ($picked.date ?? "")
            }
          
            var $picked_start_utc {
              value = (($picked_date ~ " " ~ $win_start_str ~ ":00")|to_timestamp)|transform_timestamp:"+5 hours"
            }
          
            var $picked_tech_id {
              value = ($picked.tech_id ?? 0)
            }
          
            db.edit jobs {
              field_name = "id"
              field_value = $proposal.job_id
              data = {
                technician_id    : $picked_tech_id
                scheduled_start  : $picked_start_utc
                scheduling_status: "scheduled"
                dispatch_status  : "booked"
              }
            } as $job_booked
          
            db.edit broadcast_attempt {
              field_name = "id"
              field_value = $proposal.id
              data = {status: "booked", claimed_at: now}
            } as $br_booked
          
            db.add event_log {
              data = {
                action  : "proposal_booked"
                metadata: {
                job_id         : $proposal.job_id
                broadcast_id   : $proposal.id
                picked_index   : $pick_index
                tech_id        : $picked_tech_id
                scheduled_start: $picked_start_utc
                owner_picked   : true
              }
              }
            } as $book_log
          
            // Phase 5.5C: emit APPOINTMENT_SCHEDULED for customer confirmation SMS.
            var $as_pick_obj {
              value = {
                job_id            : $proposal.job_id
                scheduled_start_ms: $picked_start_utc
                scheduled_end_ms  : null
                technician_id     : $picked_tech_id
                source            : "tech_pick"
              }
            }
          
            var $as_pick_str {
              value = $as_pick_obj|json_encode
            }
          
            db.add colony_signals {
              data = {
                signal_type    : "APPOINTMENT_SCHEDULED"
                signal_strength: 60
                source_colony  : ""
                target_colonies: ""
                payload        : $as_pick_str
              }
            } as $as_pick_signal
          
            db.add event_log {
              data = {
                action  : "appointment_scheduled_signal_emitted"
                metadata: {
                job_id            : $proposal.job_id
                signal_id         : $as_pick_signal.id
                scheduled_start_ms: $picked_start_utc
                source            : "tech_pick"
              }
              }
            } as $as_pick_log
          
            var $picked_first_name {
              value = ($picked.tech_first_name ?? "tech")
            }
          
            var $picked_day_label {
              value = ($picked.day_display ?? $picked_date)
            }
          
            var $confirm_msg {
              value = "booked: option " ~ ($pick_index|to_text) ~ " - " ~ $picked_first_name ~ " on " ~ $picked_day_label ~ " " ~ $picked_window ~ ". job " ~ ($proposal.job_id|to_text) ~ " marked scheduled."
            }
          
            return {
              value = {reply: $confirm_msg}
            }
          }
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 5. Mode select: onboarding vs daily-stub.
    // ────────────────────────────────────────────────────────
    var $reply_to_send {
      value = ""
    }
  
    // ===== TECH ASSIST ROUTING (Phase 8b) =====
    // If the tech has an active assist session, route to tech_assist_chat.
    // Must run BEFORE the onboarding/daily-stub fork so mid-job techs
    // don't accidentally hit the scheduler brain.
    conditional {
      if ($env.TECH_ASSIST_ENABLED == "true") {
        db.query tech_assist_session {
          where = $db.tech_assist_session.technician_id == $tech.id && ($db.tech_assist_session.status == "active" || $db.tech_assist_session.status == "awaiting_completion")
          sort = {tech_assist_session.created_at: "desc"}
          return = {type: "single"}
        } as $active_assist_session
      
        conditional {
          if ($active_assist_session != null) {
            api.request {
              url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/tech_assist_chat"
              method = "POST"
              params = {
                job_id       : $active_assist_session.job_id
                technician_id: $tech.id
                user_message : $input.body
                session_id   : $active_assist_session.id
              }
            
              headers = ["Content-Type: application/json"]
              timeout = 30
            } as $assist_response
          
            db.add event_log {
              data = {
                action  : "tech_sms_routed_to_assist"
                metadata: {
                tech_id   : $tech.id
                session_id: $active_assist_session.id
                job_id    : $active_assist_session.job_id
                body      : $input.body|substr:0:100
              }
              }
            } as $assist_route_log
          
            return {
              value = {success: true, routed_to: "tech_assist"}
            }
          }
        }
      }
    }
  
    // ===== END TECH ASSIST ROUTING =====
  
    conditional {
      if ($tech.onboarding_completed_at == null) {
        // ─── ONBOARDING MODE ───────────────────────────────
        // Pull recent messages (chronological) and call Anthropic.
      
        db.query agent_message {
          where = $db.agent_message.conversation_id == $conversation.id
          sort = {agent_message.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 20}}
        } as $recent_desc
      
        var $recent {
          value = $recent_desc.items|reverse
        }
      
        var $claude_messages {
          value = []
        }
      
        foreach ($recent) {
          each as $msg {
            array.push $claude_messages {
              value = {role: $msg.role, content: $msg.content}
            }
          }
        }
      
        api.request {
          url = "https://api.anthropic.com/v1/messages"
          method = "POST"
          params = {
            model     : "claude-sonnet-4-5-20250929"
            max_tokens: 1024
            system    : $env.ANT_TECH_ONBOARDING_PROMPT
            messages  : $claude_messages
          }
        
          headers = [
            "x-api-key: " ~ $env.ANTHROPIC_API_KEY
            "anthropic-version: 2023-06-01"
            "content-type: application/json"
          ]
        
          timeout = 8
        } as $claude_response
      
        // FIX 2 (2026-05-20): defensive Claude response access. Previously
        // bare $claude_response.response.result.content[0].text, which blew
        // up ERROR_FATAL when Anthropic returned an error body (no content
        // array). Root cause behind Jimmy's 14:29:45 500. See
        // docs/sms-architecture-2026-05-19.md and Netlify logs that day.
        var $claude_status {
          value = ($claude_response.response.status ?? 0)
        }
      
        var $reply_text {
          value = ""
        }
      
        conditional {
          if (($claude_status >= 200) && ($claude_status < 300)) {
            var $claude_result {
              value = ($claude_response.response.result ?? {})
            }
          
            var $claude_content {
              value = ($claude_result.content ?? [])
            }
          
            var $claude_content_count {
              value = $claude_content|count
            }
          
            conditional {
              if ($claude_content_count > 0) {
                var $claude_first {
                  value = $claude_content|get:0
                }
              
                // 2026-05-20 patch: original was
                //   if (($claude_first.text ?? null) != null) { var.update ... }
                // but Xano server-side parse/serialize strips '??' inside
                // if(...) comparisons. Push the defensive default into the
                // assignment context (which the round-trip preserves) and
                // let Fix 1's empty-reply guard handle the empty case.
                var.update $reply_text {
                  value = ($claude_first.text ?? "")
                }
              }
            }
          }
        
          else {
            // Anthropic non-2xx. Log the raw error body for diagnosis so we
            // can see WHY (validation error vs rate limit vs etc.) without
            // tailing Netlify logs. Substitute a clear retry message so the
            // tech knows to text again.
            db.add event_log {
              data = {
                action  : "tech_sms_inbound_claude_error"
                metadata: {
                tech_id             : $tech.id
                conversation_id     : $conversation.id
                status              : $claude_status
                error_body          : $claude_response.response.result|json_encode
                user_message_preview: $input.body|substr:0:200
                mode                : "onboarding"
              }
              }
            } as $claude_err_log
          
            var.update $reply_text {
              value = "hey, signal hiccup on my end. text that again in a sec?"
            }
          }
        }
      
        var $clean_reply {
          value = $reply_text
        }
      
        // ─── 6. Token parsing + action dispatch ─────────────
        // Five tokens, all PAIRED form (token + JSON + token) for clean split.
        // For each: split → extract JSON → json_decode → execute action → strip block.
      
        // __SET_HOURS__{...}__SET_HOURS__
        conditional {
          if ($reply_text|contains:"__SET_HOURS__") {
            var $hours_parts {
              value = $reply_text|split:"__SET_HOURS__"
            }
          
            var $hours_json_raw {
              value = $hours_parts|get:1|trim
            }
          
            var $hours_data {
              value = $hours_json_raw|json_decode
            }
          
            conditional {
              if ($hours_data != null) {
                db.edit technicians {
                  field_name = "id"
                  field_value = $tech.id
                  data = {
                    preferred_hours_start: $hours_data.start
                    preferred_hours_end  : $hours_data.end
                  }
                } as $tech_h_updated
              }
            }
          
            var.update $clean_reply {
              value = $clean_reply
                |regex_replace:"__SET_HOURS__[\\s\\S]*?__SET_HOURS__":""
            }
          }
        }
      
        // __SET_SUMMARY_TIME__{...}__SET_SUMMARY_TIME__
        conditional {
          if ($reply_text|contains:"__SET_SUMMARY_TIME__") {
            var $sum_parts {
              value = $reply_text|split:"__SET_SUMMARY_TIME__"
            }
          
            var $sum_json_raw {
              value = $sum_parts|get:1|trim
            }
          
            var $sum_data {
              value = $sum_json_raw|json_decode
            }
          
            conditional {
              if ($sum_data != null) {
                db.edit technicians {
                  field_name = "id"
                  field_value = $tech.id
                  data = {daily_summary_time: $sum_data.time}
                } as $tech_s_updated
              }
            }
          
            var.update $clean_reply {
              value = $clean_reply
                |regex_replace:"__SET_SUMMARY_TIME__[\\s\\S]*?__SET_SUMMARY_TIME__":""
            }
          }
        }
      
        // __SET_PERSONAL_CONTEXT__{...}__SET_PERSONAL_CONTEXT__
        conditional {
          if ($reply_text|contains:"__SET_PERSONAL_CONTEXT__") {
            var $pc_parts {
              value = $reply_text|split:"__SET_PERSONAL_CONTEXT__"
            }
          
            var $pc_json_raw {
              value = $pc_parts|get:1|trim
            }
          
            var $pc_data {
              value = $pc_json_raw|json_decode
            }
          
            conditional {
              if ($pc_data != null) {
                db.edit technicians {
                  field_name = "id"
                  field_value = $tech.id
                  data = {personal_context: $pc_data.text}
                } as $tech_pc_updated
              }
            }
          
            var.update $clean_reply {
              value = $clean_reply
                |regex_replace:"__SET_PERSONAL_CONTEXT__[\\s\\S]*?__SET_PERSONAL_CONTEXT__":""
            }
          }
        }
      
        //  __ADD_PREFERENCE__{...}__ADD_PREFERENCE__
        //  FIX 3 (2026-05-20): handle MULTIPLE preferences emitted in one turn.
        //  Previously single-shot via |split|get:1: when Claude emitted two
        //  paired blocks (e.g. saturday AND sunday off in the same turn),
        //  only the first block got persisted; the second was silently dropped
        //  by the cleanup regex. Now iterate every paired block.
        // 
        //  Paired-token split shape: "X__T__JSON1__T__Y__T__JSON2__T__Z"
        //  split on "__T__" -> [X, JSON1, Y, JSON2, Z]
        //  Odd-indexed elements (1, 3, 5, ...) are the JSON bodies.
        //  Toggle the $pref_is_json flag each iteration to detect which to parse.
        conditional {
          if ($reply_text|contains:"__ADD_PREFERENCE__") {
            var $pref_parts {
              value = $reply_text|split:"__ADD_PREFERENCE__"
            }
          
            var $pref_is_json {
              value = false
            }
          
            foreach ($pref_parts) {
              each as $pref_part {
                conditional {
                  if ($pref_is_json) {
                    var $pref_data_iter {
                      value = ($pref_part|trim)|json_decode
                    }
                  
                    conditional {
                      if ($pref_data_iter != null) {
                        db.add tech_preferences {
                          data = {
                            tech_id          : $tech.id
                            preference_type  : $pref_data_iter.preference_type
                            zip_or_area      : $pref_data_iter.zip_or_area
                            day_of_week      : $pref_data_iter.day_of_week
                            time_window_start: $pref_data_iter.time_window_start
                            time_window_end  : $pref_data_iter.time_window_end
                            strength         : $pref_data_iter.strength
                            source           : $pref_data_iter.source|first_notempty:"explicit"
                            captured_via_text: $pref_data_iter.captured_via_text
                            active           : true
                          }
                        } as $new_pref_iter
                      }
                    }
                  }
                }
              
                var.update $pref_is_json {
                  value = ($pref_is_json == false)
                }
              }
            }
          
            var.update $clean_reply {
              value = $clean_reply
                |regex_replace:"__ADD_PREFERENCE__[\\s\\S]*?__ADD_PREFERENCE__":""
            }
          }
        }
      
        // __ONBOARDING_DONE__ (bare token, no JSON)
        conditional {
          if ($reply_text|contains:"__ONBOARDING_DONE__") {
            var $now_ts {
              value = now
            }
          
            db.edit technicians {
              field_name = "id"
              field_value = $tech.id
              data = {onboarding_completed_at: $now_ts}
            } as $tech_done
          
            var.update $clean_reply {
              value = $clean_reply|replace:"__ONBOARDING_DONE__":""
            }
          }
        }
      
        // Final whitespace cleanup.
        var.update $clean_reply {
          value = $clean_reply|trim
        }
      
        // FIX 1 (2026-05-20): empty-reply guard. When Claude responds with
        // ONLY action tokens (no natural-language text), the strip leaves
        // $clean_reply empty. Empty content persisted to agent_message
        // poisons the NEXT Claude call (Anthropic rejects empty assistant
        // content with 400, which crashed the endpoint on Jimmy's retry at
        // 14:29:45). Substitute a minimal acknowledgment so:
        //   1. Tech sees a reply instead of FALLBACK_REPLY
        //   2. Next Claude call has a valid (non-empty) history
        conditional {
          if (($clean_reply|strlen) == 0) {
            var.update $clean_reply {
              value = "got it."
            }
          }
        }
      
        var.update $reply_to_send {
          value = $clean_reply
        }
      }
    
      else {
        // ─── DAILY MODE (Phase 5) ──────────────────────────
        // Real reasoning brain: pull tech context, call Anthropic with daily
        // prompt + dynamic CONTEXT block, parse 7 tokens, dispatch handlers.
      
        // ── 5a. Build tech context for the system prompt ──
      
        // Primary cluster (highest-rank active assignment).
        db.query cluster_assignment {
          where = $db.cluster_assignment.technician_id == $tech.id && $db.cluster_assignment.active == true
          sort = {cluster_assignment.rank: "asc"}
          return = {type: "single"}
        } as $primary_assignment
      
        var $primary_cluster {
          value = (($primary_assignment.cluster ?? "")|trim)
        }
      
        conditional {
          if ($primary_cluster == "") {
            var.update $primary_cluster {
              value = "(unassigned)"
            }
          }
        }
      
        // Hard + soft preferences (active only).
        db.query tech_preferences {
          where = $db.tech_preferences.tech_id == $tech.id && $db.tech_preferences.strength == "hard" && $db.tech_preferences.active == true
          return = {type: "list", paging: {page: 1, per_page: 50}}
        } as $hard_prefs
      
        db.query tech_preferences {
          where = $db.tech_preferences.tech_id == $tech.id && $db.tech_preferences.strength == "soft" && $db.tech_preferences.active == true
          return = {type: "list", paging: {page: 1, per_page: 50}}
        } as $soft_prefs
      
        var $hard_prefs_text {
          value = ""
        }
      
        foreach ($hard_prefs.items) {
          each as $hp {
            var $hp_line {
              value = "  - " ~ ($hp.preference_type ?? "") ~ ": " ~ (($hp.captured_via_text ?? "")|trim) ~ "\n"
            }
          
            var.update $hard_prefs_text {
              value = $hard_prefs_text ~ $hp_line
            }
          }
        }
      
        conditional {
          if ($hard_prefs_text == "") {
            var.update $hard_prefs_text {
              value = "  None on file.\n"
            }
          }
        }
      
        var $soft_prefs_text {
          value = ""
        }
      
        foreach ($soft_prefs.items) {
          each as $sp {
            var $sp_line {
              value = "  - " ~ ($sp.preference_type ?? "") ~ ": " ~ (($sp.captured_via_text ?? "")|trim) ~ "\n"
            }
          
            var.update $soft_prefs_text {
              value = $soft_prefs_text ~ $sp_line
            }
          }
        }
      
        conditional {
          if ($soft_prefs_text == "") {
            var.update $soft_prefs_text {
              value = "  None on file.\n"
            }
          }
        }
      
        // Pending broadcasts where this tech is in techs_notified.
        db.query broadcast_attempt {
          where = $db.broadcast_attempt.status == "open"
          return = {type: "list", paging: {page: 1, per_page: 50}}
        } as $open_broadcasts
      
        var $broadcasts_text {
          value = ""
        }
      
        foreach ($open_broadcasts.items) {
          each as $br {
            var $is_eligible {
              value = false
            }
          
            foreach ($br.techs_notified) {
              each as $entry {
                conditional {
                  if ($entry.tech_id == $tech.id) {
                    var.update $is_eligible {
                      value = true
                    }
                  }
                }
              }
            }
          
            conditional {
              if ($is_eligible) {
                db.get jobs {
                  field_name = "id"
                  field_value = $br.job_id
                } as $br_job
              
                var $br_exp_ct {
                  value = ($br.expires_at|transform_timestamp:"-5 hours")|format_timestamp:"H:i"
                }
              
                var $br_line {
                  value = "  - Broadcast #" ~ ($br.id|to_text) ~ ": " ~ (($br_job.brand ?? "")|trim) ~ " " ~ (($br_job.appliance_type ?? "")|trim) ~ " in " ~ (($br_job.cluster ?? "")|trim) ~ ", " ~ (($br_job.problem_summary ?? "")|trim) ~ ". expires " ~ $br_exp_ct ~ " CT.\n"
                }
              
                var.update $broadcasts_text {
                  value = $broadcasts_text ~ $br_line
                }
              }
            }
          }
        }
      
        conditional {
          if ($broadcasts_text == "") {
            var.update $broadcasts_text {
              value = "  None.\n"
            }
          }
        }
      
        // Scheduled jobs for next 3 days (CT).
        var $today_ct_ts {
          value = now|transform_timestamp:"-5 hours"
        }
      
        var $today_ct_date {
          value = $today_ct_ts|format_timestamp:"Y-m-d"
        }
      
        var $today_start_utc {
          value = (($today_ct_date ~ " 00:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
        }
      
        var $three_days_end_utc {
          value = $today_start_utc|transform_timestamp:"+3 days"
        }
      
        db.query jobs {
          where = $db.jobs.technician_id == $tech.id && $db.jobs.scheduled_start >= $today_start_utc && $db.jobs.scheduled_start < $three_days_end_utc && ($db.jobs.scheduling_status == "scheduled" || $db.jobs.scheduling_status == "in_progress" || $db.jobs.scheduling_status == "ready")
          sort = {jobs.scheduled_start: "asc"}
          return = {type: "list", paging: {page: 1, per_page: 50}}
        } as $upcoming_jobs
      
        var $jobs_text {
          value = ""
        }
      
        foreach ($upcoming_jobs.items) {
          each as $jb {
            db.get customer {
              field_name = "id"
              field_value = $jb.customer_id
            } as $jb_cust
          
            var $jb_ct_ts {
              value = $jb.scheduled_start|transform_timestamp:"-5 hours"
            }
          
            var $jb_minute {
              value = $jb_ct_ts|format_timestamp:"i"
            }
          
            var $jb_time {
              value = ($jb_minute == "00") ? ($jb_ct_ts|format_timestamp:"ga") : ($jb_ct_ts|format_timestamp:"g:ia")
            }
          
            var $jb_date {
              value = $jb_ct_ts|format_timestamp:"Y-m-d"
            }
          
            var $jb_line {
              value = "  - " ~ $jb_date ~ " " ~ $jb_time ~ ": " ~ (($jb_cust.first_name ?? "")|trim) ~ " " ~ (($jb_cust.last_name ?? "")|trim) ~ ", " ~ (($jb_cust.city ?? "")|trim) ~ " - " ~ (($jb.brand ?? "")|trim) ~ " " ~ (($jb.appliance_type ?? "")|trim) ~ " (job #" ~ ($jb.id|to_text) ~ ")\n"
            }
          
            var.update $jobs_text {
              value = $jobs_text ~ $jb_line
            }
          }
        }
      
        conditional {
          if ($jobs_text == "") {
            var.update $jobs_text {
              value = "  None scheduled.\n"
            }
          }
        }
      
        // Owner override flag (Teddy = tech_id 1).
        var $owner_override {
          value = "false"
        }
      
        conditional {
          if ($tech.id == 1) {
            var.update $owner_override {
              value = "true"
            }
          }
        }
      
        // Tech roster (only rendered when owner is talking) — gives Claude an
        // explicit name→id mapping so owner-tool calls don't hallucinate IDs.
        // Caught in Phase 8 testing: Claude said "Billy" but fired the token
        // with tech_id=3 (Andre) because it had no roster reference.
        var $tech_roster_text {
          value = ""
        }
      
        conditional {
          if ($owner_override == "true") {
            db.query technicians {
              where = $db.technicians.active == true
              sort = {technicians.id: "asc"}
              return = {type: "list", paging: {page: 1, per_page: 50}}
            } as $roster_techs
          
            var $roster_lines {
              value = ""
            }
          
            foreach ($roster_techs.items) {
              each as $rt {
                var $rt_first {
                  value = ($rt.first_name ?? "")|trim
                }
              
                var $rt_last {
                  value = ($rt.last_name ?? "")|trim
                }
              
                var.update $roster_lines {
                  value = $roster_lines ~ "  tech_id=" ~ ($rt.id|to_text) ~ ": " ~ $rt_first ~ " " ~ $rt_last ~ "\n"
                }
              }
            }
          
            var.update $tech_roster_text {
              value = "\n\nTECH ROSTER (use these exact tech_id values for owner-tool calls — do NOT guess):\n" ~ $roster_lines
            }
          }
        }
      
        // Compose CONTEXT block. Today's date is anchored so the LLM can
        // resolve "tomorrow", "next monday", etc. relative to the actual day.
        // Filter calls hoisted into separate vars to avoid any inline-precedence
        // ambiguity inside the long string concat.
        var $today_date_str {
          value = $today_ct_ts|format_timestamp:"Y-m-d"
        }
      
        var $today_day_str {
          value = $today_ct_ts|format_timestamp:"l"
        }
      
        // 7-day calendar so Claude resolves day-of-week by lookup instead of
        // arithmetic. All anchored to $today_ct_ts so the day boundaries match
        // the rest of the daily-mode handler's notion of "today".
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
      
        var $tech_first_str {
          value = ($tech.first_name ?? "")|trim
        }
      
        var $tech_last_str {
          value = ($tech.last_name ?? "")|trim
        }
      
        var $tech_id_str {
          value = $tech.id|to_text
        }
      
        // PENDING PATTERN OFFER section — only renders when nightly ledger task
        // detected a 3+ decline cluster the tech doesn't already have a pref for.
        var $pattern_offer_text {
          value = ""
        }
      
        conditional {
          if ($tech.pending_pattern_offer != null) {
            var $po_dim {
              value = ($tech.pending_pattern_offer.dimension ?? "")
            }
          
            var $po_val {
              value = ($tech.pending_pattern_offer.value ?? "")
            }
          
            var $po_count_str {
              value = ($tech.pending_pattern_offer.match_count ?? 0)|to_text
            }
          
            conditional {
              if ($po_dim != "" && $po_val != "") {
                var $po_instructions {
                  value = ""
                }
              
                conditional {
                  if ($po_dim == "city") {
                    var.update $po_instructions {
                      value = "fire __ADD_PREFERENCE__ with preference_type=geographic, zip_or_area=\"" ~ $po_val ~ "\", strength=soft, source=pattern_detected"
                    }
                  }
                
                  else {
                    conditional {
                      if ($po_dim == "day_of_week") {
                        var.update $po_instructions {
                          value = "fire __ADD_PREFERENCE__ with preference_type=time, day_of_week=\"" ~ $po_val ~ "\", strength=soft, source=pattern_detected"
                        }
                      }
                    
                      else {
                        conditional {
                          if ($po_dim == "time_window") {
                            var.update $po_instructions {
                              value = "fire __ADD_PREFERENCE__ with preference_type=time, captured_via_text=\"pattern: 3+ declines in " ~ $po_val ~ "\", strength=soft, source=pattern_detected (note: time_window itself doesn't map to a single field — describe it in captured_via_text and skip time_window_start/end)"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              
                var.update $pattern_offer_text {
                  value = "\n\nPENDING PATTERN OFFER:\n  Dimension: " ~ $po_dim ~ "\n  Value: " ~ $po_val ~ "\n  Match count: " ~ $po_count_str ~ " declines over last 14 days\n\n  Bring this up casually if there's a natural opening. Example:\n  \"noticed you've passed on a few " ~ $po_val ~ " jobs lately. want me to lighten up?\"\n  If tech says yes, " ~ $po_instructions ~ "."
                }
              }
            }
          }
        }
      
        var $context_block {
          value = "\n\n# CURRENT CONTEXT\n\nToday: " ~ $today_date_str ~ " (" ~ $today_day_str ~ ") - Central Time" ~ $calendar_text ~ "\n\nTech: " ~ $tech_first_str ~ " " ~ $tech_last_str ~ " (tech_id=" ~ $tech_id_str ~ ", primary cluster=" ~ $primary_cluster ~ ")\n\nHARD PREFERENCES:\n" ~ $hard_prefs_text ~ "\nSOFT PREFERENCES:\n" ~ $soft_prefs_text ~ "\nPENDING BROADCASTS YOU'RE ELIGIBLE TO CLAIM:\n" ~ $broadcasts_text ~ "\nYOUR JOBS (next 3 days):\n" ~ $jobs_text ~ "\nOWNER OVERRIDE: " ~ $owner_override ~ $tech_roster_text ~ $pattern_offer_text
        }
      
        // ── 5b. Pull recent messages, build claude_messages array ──
        db.query agent_message {
          where = $db.agent_message.conversation_id == $conversation.id
          sort = {agent_message.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 20}}
        } as $recent_d_desc
      
        var $recent_d {
          value = $recent_d_desc.items|reverse
        }
      
        var $claude_messages_d {
          value = []
        }
      
        var $last_pushed_role {
          value = ""
        }
      
        foreach ($recent_d) {
          each as $msg_d {
            // Hoist filter into vars to dodge any precedence ambiguity.
            var $msg_role {
              value = $msg_d.role
            }
          
            var $msg_content {
              value = $msg_d.content
            }
          
            var $msg_trimmed {
              value = ($msg_content ?? "")|trim
            }
          
            conditional {
              if ($msg_trimmed != "") {
                conditional {
                  if ($msg_role != $last_pushed_role) {
                    array.push $claude_messages_d {
                      value = {role: $msg_role, content: $msg_content}
                    }
                  
                    var.update $last_pushed_role {
                      value = $msg_role
                    }
                  }
                }
              }
            }
          }
        }
      
        // ── 5c. Anthropic call ──
        api.request {
          url = "https://api.anthropic.com/v1/messages"
          method = "POST"
          params = {
            model     : "claude-sonnet-4-5-20250929"
            max_tokens: 1024
            system    : ($env.ANT_TECH_DAILY_PROMPT ~ $context_block)
            messages  : $claude_messages_d
          }
        
          headers = [
            "x-api-key: " ~ $env.ANTHROPIC_API_KEY
            "anthropic-version: 2023-06-01"
            "content-type: application/json"
          ]
        
          timeout = 30
        } as $claude_response_d
      
        var $reply_text_d {
          value = $claude_response_d.response.result.content[0].text
        }
      
        var $clean_reply_d {
          value = $reply_text_d
        }
      
        // ── 5d. Token dispatch (7 tokens, declared order) ──
      
        // 1. __CLAIM_BROADCAST__
        conditional {
          if ($reply_text_d|contains:"__CLAIM_BROADCAST__") {
            var $cb_parts {
              value = $reply_text_d|split:"__CLAIM_BROADCAST__"
            }
          
            var $cb_json_raw {
              value = $cb_parts|get:1|trim
            }
          
            var $cb_data {
              value = $cb_json_raw|json_decode
            }
          
            conditional {
              if ($cb_data != null && $cb_data.broadcast_id != null) {
                // Race-safe two-step: query open broadcast, then edit if found.
                db.query broadcast_attempt {
                  where = $db.broadcast_attempt.id == $cb_data.broadcast_id && $db.broadcast_attempt.status == "open"
                  return = {type: "single"}
                } as $open_br
              
                conditional {
                  if ($open_br != null) {
                    // Win path. Default scheduled_start = tomorrow 08:00 CT
                    // since open-broadcast SMS doesn't carry a time. Office
                    // can refine via the calendar before the actual visit.
                    var $claim_now_ct {
                      value = now|transform_timestamp:"-5 hours"
                    }
                  
                    var $claim_tomorrow_date {
                      value = $claim_now_ct
                        |transform_timestamp:"+1 days"
                        |format_timestamp:"Y-m-d"
                    }
                  
                    var $claim_default_start {
                      value = (($claim_tomorrow_date ~ " 08:00:00")|to_timestamp)|transform_timestamp:"+5 hours"
                    }
                  
                    db.edit broadcast_attempt {
                      field_name = "id"
                      field_value = $cb_data.broadcast_id
                      data = {
                        claimed_by_tech_id: $tech.id
                        claimed_at        : now
                        status            : "claimed"
                      }
                    } as $br_claimed
                  
                    db.edit jobs {
                      field_name = "id"
                      field_value = $open_br.job_id
                      data = {
                        technician_id      : $tech.id
                        accepted_by_tech_id: $tech.id
                        accepted_at        : now
                        dispatch_status    : "accepted"
                        scheduling_status  : "scheduled"
                        scheduled_start    : $claim_default_start
                      }
                    } as $job_claimed
                  
                    // Phase 5.5C: emit APPOINTMENT_SCHEDULED. Source "tech_claim"
                    // tells the agent to SKIP the customer SMS — the broadcast
                    // default time (tomorrow 8am) is a placeholder, not a
                    // customer-confirmed appointment yet.
                    var $as_claim_obj {
                      value = {
                        job_id            : $open_br.job_id
                        scheduled_start_ms: $claim_default_start
                        scheduled_end_ms  : null
                        technician_id     : $tech.id
                        source            : "tech_claim"
                      }
                    }
                  
                    var $as_claim_str {
                      value = $as_claim_obj|json_encode
                    }
                  
                    db.add colony_signals {
                      data = {
                        signal_type    : "APPOINTMENT_SCHEDULED"
                        signal_strength: 60
                        source_colony  : ""
                        target_colonies: ""
                        payload        : $as_claim_str
                      }
                    } as $as_claim_signal
                  
                    db.add event_log {
                      data = {
                        action  : "appointment_scheduled_signal_emitted"
                        metadata: {
                        job_id            : $open_br.job_id
                        signal_id         : $as_claim_signal.id
                        scheduled_start_ms: $claim_default_start
                        source            : "tech_claim"
                      }
                      }
                    } as $as_claim_log
                  
                    db.get jobs {
                      field_name = "id"
                      field_value = $open_br.job_id
                    } as $cb_job
                  
                    // Notify other techs.
                    foreach ($open_br.techs_notified) {
                      each as $other {
                        conditional {
                          if ($other.tech_id != $tech.id && ($other.phone ? "" : ) != "") {
                            var $other_body {
                              value = "yo, " ~ (($cb_job.brand ?? "")|trim) ~ " " ~ (($cb_job.appliance_type ?? "")|trim) ~ " in " ~ (($cb_job.cluster ?? "")|trim) ~ " got grabbed by " ~ (($tech.first_name ?? "")|trim) ~ ". ill ping you when the next one comes through."
                            }
                          
                            // ── SMS_ENABLED gate (call_site: tech_sms_inbound_POST.xs:892) ──
                            var $gate892_recipient_e164 {
                              value = "+1" ~ $other.phone
                            }
                          
                            var $gate892_is_owner {
                              value = ($gate892_recipient_e164 == "+16154855795") || ($other.phone == "6154855795")
                            }
                          
                            var $gate892_sms_enabled {
                              value = (($env.SMS_ENABLED ?? "false") == "true")
                            }
                          
                            var $gate892_should_send {
                              value = $gate892_sms_enabled || $gate892_is_owner
                            }
                          
                            conditional {
                              if ($gate892_should_send == false) {
                                db.add event_log {
                                  data = {
                                    action  : "sms_gated"
                                    metadata: {
                                    recipient    : $gate892_recipient_e164
                                    body_preview : $other_body|substr:0:200
                                    gated_reason : "SMS_ENABLED=false, non-owner recipient"
                                    call_site    : "tech_sms_inbound_POST.xs:892"
                                    other_tech_id: $other.tech_id
                                  }
                                  }
                                } as $gate892_log
                              }
                            
                              else {
                                conditional {
                                  if ($gate892_is_owner && $gate892_sms_enabled == false) {
                                    db.add event_log {
                                      data = {
                                        action  : "sms_owner_bypass"
                                        metadata: {
                                        recipient    : $gate892_recipient_e164
                                        body_preview : $other_body|substr:0:200
                                        call_site    : "tech_sms_inbound_POST.xs:892"
                                        other_tech_id: $other.tech_id
                                      }
                                      }
                                    } as $bypass892_log
                                  }
                                }
                              
                                api.request {
                                  url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                                  method = "POST"
                                  params = {
                                    From: "+17273508487"
                                    To  : "+1" ~ $other.phone
                                    Body: $other_body
                                  }
                                
                                  headers = [
                                    "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                                    "Content-Type: application/x-www-form-urlencoded"
                                  ]
                                } as $other_resp
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                
                  else {
                    // Race lost.
                    var.update $clean_reply_d {
                      value = $clean_reply_d ~ "\n\n(sorry, that one was already taken)"
                    }
                  }
                }
              }
            }
          
            // Strip via split/rejoin (regex_replace with [\s\S]*? returns null).
            var $cb_strip_parts {
              value = $clean_reply_d|split:"__CLAIM_BROADCAST__"
            }
          
            conditional {
              if (($cb_strip_parts|count) >= 3) {
                var.update $clean_reply_d {
                  value = `($cb_strip_parts|get:0) ~ ($cb_strip_parts|get:2)`
                }
              }
            }
          }
        }
      
        // 2. __DECLINE_BROADCAST__
        conditional {
          if ($reply_text_d|contains:"__DECLINE_BROADCAST__") {
            var $db_parts {
              value = $reply_text_d|split:"__DECLINE_BROADCAST__"
            }
          
            var $db_json_raw {
              value = $db_parts|get:1|trim
            }
          
            var $db_data {
              value = $db_json_raw|json_decode
            }
          
            conditional {
              if ($db_data != null && $db_data.broadcast_id != null) {
                db.add event_log {
                  data = {
                    action  : "broadcast_decline"
                    metadata: {
                    broadcast_id: $db_data.broadcast_id
                    tech_id     : $tech.id
                    reason      : ($db_data.reason ?? "")
                  }
                  }
                } as $db_log
              }
            }
          
            var $db_strip_parts {
              value = $clean_reply_d|split:"__DECLINE_BROADCAST__"
            }
          
            conditional {
              if (($db_strip_parts|count) >= 3) {
                var.update $clean_reply_d {
                  value = `($db_strip_parts|get:0) ~ ($db_strip_parts|get:2)`
                }
              }
            }
          }
        }
      
        // 3. __UPDATE_AVAILABILITY__
        conditional {
          if ($reply_text_d|contains:"__UPDATE_AVAILABILITY__") {
            var $av_parts {
              value = $reply_text_d|split:"__UPDATE_AVAILABILITY__"
            }
          
            var $av_json_raw {
              value = $av_parts|get:1|trim
            }
          
            var $av_data {
              value = $av_json_raw|json_decode
            }
          
            conditional {
              if ($av_data != null && $av_data.date != null) {
                var $av_is_off {
                  value = ($av_data.available == false) ? true : false
                }
              
                db.query tech_availability {
                  where = $db.tech_availability.technician_id == $tech.id && $db.tech_availability.blocked_date == $av_data.date
                  return = {type: "single"}
                } as $av_existing
              
                conditional {
                  if ($av_existing != null) {
                    db.edit tech_availability {
                      field_name = "id"
                      field_value = $av_existing.id
                      data = {
                        full_day_off: $av_is_off
                        reason      : ($av_data.reason ?? "")
                      }
                    } as $av_updated
                  }
                
                  else {
                    db.add tech_availability {
                      data = {
                        technician_id: $tech.id
                        blocked_date : $av_data.date
                        full_day_off : $av_is_off
                        reason       : ($av_data.reason ?? "")
                        start_time   : "08:00"
                        end_time     : "16:00"
                      }
                    } as $av_new
                  }
                }
              
                // Sick-day cascade trigger: enqueue async cascade if the
                // unavailability is for TODAY (CT). Future-dated sick days
                // just write the row and skip the cascade.
                conditional {
                  if ($av_is_off && $av_data.date == $today_ct_date) {
                    db.add scheduling_queue {
                      data = {
                        action_type: "sick_day_cascade"
                        status     : "pending"
                        metadata   : {
                        tech_id  : $tech.id
                        sick_date: $av_data.date
                        reason   : ($av_data.reason ?? "")
                      }
                      }
                    } as $cascade_queued
                  }
                }
              }
            }
          
            // Strip the token block via split/rejoin (regex_replace with
            // [\s\S]*? returns null in XanoScript — confirmed bug).
            // Splits into [pre, json, post]; rejoin pre + post.
            var $av_strip_parts {
              value = $clean_reply_d|split:"__UPDATE_AVAILABILITY__"
            }
          
            conditional {
              if (($av_strip_parts|count) >= 3) {
                var.update $clean_reply_d {
                  value = `($av_strip_parts|get:0) ~ ($av_strip_parts|get:2)`
                }
              }
            }
          }
        }
      
        // 4. __ADD_PREFERENCE__ (same shape as Phase 1 onboarding handler)
        conditional {
          if ($reply_text_d|contains:"__ADD_PREFERENCE__") {
            var $pref_parts_d {
              value = $reply_text_d|split:"__ADD_PREFERENCE__"
            }
          
            var $pref_json_raw_d {
              value = $pref_parts_d|get:1|trim
            }
          
            var $pref_data_d {
              value = $pref_json_raw_d|json_decode
            }
          
            conditional {
              if ($pref_data_d != null) {
                db.add tech_preferences {
                  data = {
                    tech_id          : $tech.id
                    preference_type  : $pref_data_d.preference_type
                    zip_or_area      : $pref_data_d.zip_or_area
                    day_of_week      : $pref_data_d.day_of_week
                    time_window_start: $pref_data_d.time_window_start
                    time_window_end  : $pref_data_d.time_window_end
                    strength         : $pref_data_d.strength
                    source           : $pref_data_d.source|first_notempty:"explicit"
                    captured_via_text: $pref_data_d.captured_via_text
                    active           : true
                  }
                } as $new_pref_d
              
                // If this preference was added in response to a pattern offer,
                // clear the pending offer so it doesn't get re-suggested.
                conditional {
                  if ($pref_data_d.source == "pattern_detected") {
                    db.edit technicians {
                      field_name = "id"
                      field_value = $tech.id
                      data = {pending_pattern_offer: null}
                    } as $tech_pattern_cleared
                  }
                }
              }
            }
          
            var $pref_strip_parts {
              value = $clean_reply_d|split:"__ADD_PREFERENCE__"
            }
          
            conditional {
              if (($pref_strip_parts|count) >= 3) {
                var.update $clean_reply_d {
                  value = `($pref_strip_parts|get:0) ~ ($pref_strip_parts|get:2)`
                }
              }
            }
          }
        }
      
        // 5. __RESCHEDULE_JOB__
        conditional {
          if ($reply_text_d|contains:"__RESCHEDULE_JOB__") {
            var $rs_parts {
              value = $reply_text_d|split:"__RESCHEDULE_JOB__"
            }
          
            var $rs_json_raw {
              value = $rs_parts|get:1|trim
            }
          
            var $rs_data {
              value = $rs_json_raw|json_decode
            }
          
            conditional {
              if ($rs_data != null && $rs_data.job_id != null && $rs_data.new_date != null && $rs_data.new_time != null) {
                db.get jobs {
                  field_name = "id"
                  field_value = $rs_data.job_id
                } as $rs_job
              
                conditional {
                  if ($rs_job != null && $rs_job.technician_id == $tech.id) {
                    // Authorized: convert CT date+time to UTC timestamp, edit job.
                    var $rs_new_start {
                      value = (($rs_data.new_date ~ " " ~ $rs_data.new_time ~ ":00")|to_timestamp)|transform_timestamp:"+5 hours"
                    }
                  
                    db.edit jobs {
                      field_name = "id"
                      field_value = $rs_data.job_id
                      data = {scheduled_start: $rs_new_start}
                    } as $rs_updated
                  
                    db.add event_log {
                      data = {
                        action  : "job_rescheduled_by_tech"
                        metadata: {
                        job_id  : $rs_data.job_id
                        tech_id : $tech.id
                        new_date: $rs_data.new_date
                        new_time: $rs_data.new_time
                        reason  : ($rs_data.reason ?? "")
                      }
                      }
                    } as $rs_log
                  
                    // Phase 5.5C: emit APPOINTMENT_SCHEDULED. Source
                    // "tech_reschedule" skips the tech SMS (they just did
                    // the action) but the customer still gets a confirmation
                    // with the new time.
                    var $as_resched_obj {
                      value = {
                        job_id            : $rs_data.job_id
                        scheduled_start_ms: $rs_new_start
                        scheduled_end_ms  : null
                        technician_id     : $tech.id
                        source            : "tech_reschedule"
                      }
                    }
                  
                    var $as_resched_str {
                      value = $as_resched_obj|json_encode
                    }
                  
                    db.add colony_signals {
                      data = {
                        signal_type    : "APPOINTMENT_SCHEDULED"
                        signal_strength: 60
                        source_colony  : ""
                        target_colonies: ""
                        payload        : $as_resched_str
                      }
                    } as $as_resched_signal
                  
                    db.add event_log {
                      data = {
                        action  : "appointment_scheduled_signal_emitted"
                        metadata: {
                        job_id            : $rs_data.job_id
                        signal_id         : $as_resched_signal.id
                        scheduled_start_ms: $rs_new_start
                        source            : "tech_reschedule"
                      }
                      }
                    } as $as_resched_log
                  }
                
                  else {
                    // Unauthorized: log + escalate to Teddy.
                    db.add event_log {
                      data = {
                        action  : "unauthorized_reschedule_attempt"
                        metadata: {
                        job_id        : $rs_data.job_id
                        tech_id       : $tech.id
                        actual_tech_id: ($rs_job.technician_id ?? 0)
                      }
                      }
                    } as $rs_unauth_log
                  
                    var.update $clean_reply_d {
                      value = $clean_reply_d ~ "\n\n(cant reschedule someone elses job — escalating to teddy)"
                    }
                  
                    var $rs_unauth_body {
                      value = "[ant] " ~ (($tech.first_name ?? "")|trim) ~ " (tech_id " ~ ($tech.id|to_text) ~ ") tried to reschedule job " ~ ($rs_data.job_id|to_text) ~ " which belongs to tech_id " ~ (($rs_job.technician_id ?? 0)|to_text) ~ ". reason: " ~ ($rs_data.reason ?? "(none)")
                    }
                  
                    // ── SMS_ENABLED gate (call_site: tech_sms_inbound_POST.xs:1187) ──
                    var $gate1187_recipient_e164 {
                      value = ($env.OWNER_PHONE_NUMBER ?? "")|trim
                    }
                  
                    var $gate1187_recipient_bare {
                      value = $gate1187_recipient_e164|replace:"+1":""
                    }
                  
                    var $gate1187_is_owner {
                      value = ($gate1187_recipient_e164 == "+16154855795") || ($gate1187_recipient_bare == "6154855795")
                    }
                  
                    var $gate1187_sms_enabled {
                      value = (($env.SMS_ENABLED ?? "false") == "true")
                    }
                  
                    var $gate1187_should_send {
                      value = $gate1187_sms_enabled || $gate1187_is_owner
                    }
                  
                    conditional {
                      if ($gate1187_should_send == false) {
                        db.add event_log {
                          data = {
                            action  : "sms_gated"
                            metadata: {
                            recipient   : $gate1187_recipient_e164
                            body_preview: $rs_unauth_body|substr:0:200
                            gated_reason: "SMS_ENABLED=false, non-owner recipient"
                            call_site   : "tech_sms_inbound_POST.xs:1187"
                            tech_id     : $tech.id
                          }
                          }
                        } as $gate1187_log
                      }
                    
                      else {
                        conditional {
                          if ($gate1187_is_owner && $gate1187_sms_enabled == false) {
                            db.add event_log {
                              data = {
                                action  : "sms_owner_bypass"
                                metadata: {
                                recipient   : $gate1187_recipient_e164
                                body_preview: $rs_unauth_body|substr:0:200
                                call_site   : "tech_sms_inbound_POST.xs:1187"
                                tech_id     : $tech.id
                              }
                              }
                            } as $bypass1187_log
                          }
                        }
                      
                        api.request {
                          url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                          method = "POST"
                          params = {
                            From: "+17273508487"
                            To  : $env.OWNER_PHONE_NUMBER
                            Body: $rs_unauth_body
                          }
                        
                          headers = [
                            "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                            "Content-Type: application/x-www-form-urlencoded"
                          ]
                        } as $rs_unauth_sms
                      }
                    }
                  }
                }
              }
            }
          
            var $rs_strip_parts {
              value = $clean_reply_d|split:"__RESCHEDULE_JOB__"
            }
          
            conditional {
              if (($rs_strip_parts|count) >= 3) {
                var.update $clean_reply_d {
                  value = `($rs_strip_parts|get:0) ~ ($rs_strip_parts|get:2)`
                }
              }
            }
          }
        }
      
        // 6. __ESCALATE_TO_OWNER__
        conditional {
          if ($reply_text_d|contains:"__ESCALATE_TO_OWNER__") {
            var $esc_parts {
              value = $reply_text_d|split:"__ESCALATE_TO_OWNER__"
            }
          
            var $esc_json_raw {
              value = $esc_parts|get:1|trim
            }
          
            var $esc_data {
              value = $esc_json_raw|json_decode
            }
          
            conditional {
              if ($esc_data != null && ($esc_data.message ? "" : ) != "") {
                db.add event_log {
                  data = {
                    action  : "escalate_to_owner"
                    metadata: {
                    from_tech_id  : $tech.id
                    from_tech_name: (($tech.first_name ?? "")|trim) ~ " " ~ (($tech.last_name ?? "")|trim)
                    message       : $esc_data.message
                    job_id        : ($esc_data.job_id ?? null)
                  }
                  }
                } as $esc_log
              
                var $esc_body {
                  value = "[ant] " ~ (($tech.first_name ?? "")|trim) ~ ": " ~ $esc_data.message
                }
              
                // ── SMS_ENABLED gate (call_site: tech_sms_inbound_POST.xs:1248) ──
                var $gate1248_recipient_e164 {
                  value = ($env.OWNER_PHONE_NUMBER ?? "")|trim
                }
              
                var $gate1248_recipient_bare {
                  value = $gate1248_recipient_e164|replace:"+1":""
                }
              
                var $gate1248_is_owner {
                  value = ($gate1248_recipient_e164 == "+16154855795") || ($gate1248_recipient_bare == "6154855795")
                }
              
                var $gate1248_sms_enabled {
                  value = (($env.SMS_ENABLED ?? "false") == "true")
                }
              
                var $gate1248_should_send {
                  value = $gate1248_sms_enabled || $gate1248_is_owner
                }
              
                conditional {
                  if ($gate1248_should_send == false) {
                    db.add event_log {
                      data = {
                        action  : "sms_gated"
                        metadata: {
                        recipient   : $gate1248_recipient_e164
                        body_preview: $esc_body|substr:0:200
                        gated_reason: "SMS_ENABLED=false, non-owner recipient"
                        call_site   : "tech_sms_inbound_POST.xs:1248"
                        tech_id     : $tech.id
                      }
                      }
                    } as $gate1248_log
                  }
                
                  else {
                    conditional {
                      if ($gate1248_is_owner && $gate1248_sms_enabled == false) {
                        db.add event_log {
                          data = {
                            action  : "sms_owner_bypass"
                            metadata: {
                            recipient   : $gate1248_recipient_e164
                            body_preview: $esc_body|substr:0:200
                            call_site   : "tech_sms_inbound_POST.xs:1248"
                            tech_id     : $tech.id
                          }
                          }
                        } as $bypass1248_log
                      }
                    }
                  
                    api.request {
                      url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                      method = "POST"
                      params = {
                        From: "+17273508487"
                        To  : $env.OWNER_PHONE_NUMBER
                        Body: $esc_body
                      }
                    
                      headers = [
                        "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                        "Content-Type: application/x-www-form-urlencoded"
                      ]
                    } as $esc_sms
                  }
                }
              }
            }
          
            var $esc_strip_parts {
              value = $clean_reply_d|split:"__ESCALATE_TO_OWNER__"
            }
          
            conditional {
              if (($esc_strip_parts|count) >= 3) {
                var.update $clean_reply_d {
                  value = `($esc_strip_parts|get:0) ~ ($esc_strip_parts|get:2)`
                }
              }
            }
          }
        }
      
        // 7. __QUERY_MY_NUMBERS__ — real readout from tech_performance_ledger.
        // Phase 7b refactor: dual-trigger via flag. The append fires when EITHER
        // Claude emits the token OR the user's message body matches numbers-intent
        // patterns. The pattern fallback is deterministic; Claude's token-firing
        // for this specific tool was inconsistent in Phase 7 testing.
        var $force_numbers_append {
          value = false
        }
      
        // (a) Token detection — when Claude fired the token, strip it tolerantly
        //     (handles paired __TOKEN__{}__TOKEN__ AND bare __TOKEN__ forms).
        conditional {
          if ($reply_text_d|contains:"__QUERY_MY_NUMBERS__") {
            var.update $clean_reply_d {
              value = $clean_reply_d
                |replace:"__QUERY_MY_NUMBERS__{}":""
            }
          
            var.update $clean_reply_d {
              value = $clean_reply_d
                |replace:"__QUERY_MY_NUMBERS__":""
            }
          
            var.update $force_numbers_append {
              value = true
            }
          }
        }
      
        // (b) Pattern-match fallback — if user's message asks about numbers,
        //     force the append regardless of whether Claude fired the token.
        // Each `contains` expression wrapped in parens — XanoScript filter
        // precedence binds greedily to the right, so `|contains:"X" || $var|...`
        // can mis-parse the `||` as part of the filter argument.
        var $body_lower {
          value = ($input.body ?? "")|to_lower
        }
      
        conditional {
          if (($body_lower|contains:"my numbers") || ($body_lower|contains:"my number") || ($body_lower|contains:"how am i doing") || ($body_lower|contains:"how am i performing") || ($body_lower|contains:"acceptance rate") || ($body_lower|contains:"my stats") || ($body_lower|contains:"my performance") || ($body_lower|contains:"whats my") || ($body_lower|contains:"what's my") || ($body_lower|contains:"show me my")) {
            var.update $force_numbers_append {
              value = true
            }
          }
        }
      
        // (c) Single ledger lookup + format + append block. Runs at most once.
        conditional {
          if ($force_numbers_append) {
            db.query tech_performance_ledger {
              where = $db.tech_performance_ledger.tech_id == $tech.id
              sort = {tech_performance_ledger.period_end: "desc"}
              return = {type: "single"}
            } as $ledger_row
          
            var $numbers_text {
              value = ""
            }
          
            conditional {
              if ($ledger_row == null) {
                var.update $numbers_text {
                  value = """
                    
                    
                    (numbers system just kicked in - give it 24h then ask again.)
                    """
                }
              }
            
              else {
                var $rate_int {
                  value = ($ledger_row.acceptance_rate ?? 0)|to_int
                }
              
                var $team_int {
                  value = ($ledger_row.team_avg_acceptance_rate ?? 0)|to_int
                }
              
                var $delta {
                  value = $rate_int - $team_int
                }
              
                var $position {
                  value = ($delta > 5) ? "ahead of" : (($delta < -5) ? "below" : "right around")
                }
              
                var $offered_str {
                  value = ($ledger_row.offered_count ?? 0)|to_text
                }
              
                var $accepted_str {
                  value = ($ledger_row.accepted_count ?? 0)|to_text
                }
              
                var $called_off_str {
                  value = ($ledger_row.called_off_count ?? 0)|to_text
                }
              
                var $helped_out_str {
                  value = ($ledger_row.helped_out_count ?? 0)|to_text
                }
              
                var.update $numbers_text {
                  value = "\n\n30-day numbers for you:\n- offered: " ~ $offered_str ~ "\n- accepted: " ~ $accepted_str ~ " (" ~ ($rate_int|to_text) ~ "%)\n- called off: " ~ $called_off_str ~ "\n- helped out: " ~ $helped_out_str ~ "\n\nteam avg acceptance: " ~ ($team_int|to_text) ~ "%. youre " ~ $position ~ " the pack."
                }
              }
            }
          
            var.update $clean_reply_d {
              value = $clean_reply_d ~ $numbers_text
            }
          }
        }
      
        // 7b. __QUERY_MY_PAY__ - real readout from tech_earnings table.
        // Mirrors __QUERY_MY_NUMBERS__ structure (dual-trigger via flag,
        // tolerant token strip, pattern fallback, single query+format+append).
        // Earnings stubs are written by tech_job_complete; commission_earned
        // gets backfilled when payment is reconciled (stripe webhook for
        // self_pay, remittance match for warranty). Until then, totals are 0.
        var $force_pay_append {
          value = false
        }
      
        // (a) Token detection - handles paired __TOKEN__{}__TOKEN__ AND bare.
        conditional {
          if ($reply_text_d|contains:"__QUERY_MY_PAY__") {
            var.update $clean_reply_d {
              value = $clean_reply_d|replace:"__QUERY_MY_PAY__{}":""
            }
          
            var.update $clean_reply_d {
              value = $clean_reply_d|replace:"__QUERY_MY_PAY__":""
            }
          
            var.update $force_pay_append {
              value = true
            }
          }
        }
      
        // (b) Pattern-match fallback. Reuses $body_lower from the numbers block.
        conditional {
          if (($body_lower|contains:"my pay") || ($body_lower|contains:"my payout") || ($body_lower|contains:"how much have i earned") || ($body_lower|contains:"when do i get paid") || ($body_lower|contains:"when is payday") || ($body_lower|contains:"whats my pay") || ($body_lower|contains:"what's my pay") || ($body_lower|contains:"my paycheck") || ($body_lower|contains:"how much do i make") || ($body_lower|contains:"show me my pay")) {
            var.update $force_pay_append {
              value = true
            }
          }
        }
      
        // (c) Single earnings query + aggregation + format + append.
        conditional {
          if ($force_pay_append) {
            db.query tech_earnings {
              where = $db.tech_earnings.tech_id == $tech.id
              return = {type: "list", paging: {page: 1, per_page: 1000}}
            } as $earnings_list
          
            var $total_earned {
              value = 0
            }
          
            var $total_paid {
              value = 0
            }
          
            var $pending_count {
              value = 0
            }
          
            var $completed_count {
              value = 0
            }
          
            foreach ($earnings_list.items) {
              each as $e {
                var $ce {
                  value = ($e.commission_earned ?? 0)
                }
              
                var.update $total_earned {
                  value = $total_earned + $ce
                }
              
                var.update $completed_count {
                  value = $completed_count + 1
                }
              
                conditional {
                  if ($e.status == "paid") {
                    var.update $total_paid {
                      value = $total_paid + $ce
                    }
                  }
                
                  elseif ($e.status == "pending_payment") {
                    var.update $pending_count {
                      value = $pending_count + 1
                    }
                  }
                }
              }
            }
          
            var $still_owed {
              value = $total_earned - $total_paid
            }
          
            // Next payout: 3rd or 18th of each month, whichever is next.
            // Uses $today_ct_ts from the daily-mode block above (~line 639).
            var $today_dom {
              value = ($today_ct_ts|format_timestamp:"j")|to_int
            }
          
            var $today_ym {
              value = $today_ct_ts|format_timestamp:"Y-m"
            }
          
            var $next_payout_date {
              value = ""
            }
          
            conditional {
              if ($today_dom < 3) {
                var.update $next_payout_date {
                  value = $today_ym ~ "-03"
                }
              }
            
              elseif ($today_dom < 18) {
                var.update $next_payout_date {
                  value = $today_ym ~ "-18"
                }
              }
            
              else {
                var $next_month_ts {
                  value = $today_ct_ts|transform_timestamp:"+1 month"
                }
              
                var $next_month_ym {
                  value = $next_month_ts|format_timestamp:"Y-m"
                }
              
                var.update $next_payout_date {
                  value = $next_month_ym ~ "-03"
                }
              }
            }
          
            var $pay_text {
              value = ""
            }
          
            conditional {
              if ($completed_count == 0) {
                var.update $pay_text {
                  value = "\n\nyour earnings: no completed jobs yet. next payout: " ~ $next_payout_date ~ "."
                }
              }
            
              else {
                var.update $pay_text {
                  value = "\n\nyour earnings:\ncompleted jobs: " ~ ($completed_count|to_text) ~ " (" ~ ($pending_count|to_text) ~ " pending payment)\ntotal earned: $" ~ ($total_earned|to_text) ~ "\npaid to date: $" ~ ($total_paid|to_text) ~ "\nstill owed: $" ~ ($still_owed|to_text) ~ "\nnext payout: " ~ $next_payout_date
                }
              }
            }
          
            var.update $clean_reply_d {
              value = $clean_reply_d ~ $pay_text
            }
          }
        }
      
        // 8. __OWNER_REASSIGN_JOB__ (Phase 8: owner-only cross-tech reassignment)
        // Defensive: $tech.id == 1 (Teddy) required. Even if Claude erroneously
        // emits this from a non-owner conversation, the handler refuses to act.
        conditional {
          if ($reply_text_d|contains:"__OWNER_REASSIGN_JOB__") {
            var $orj_parts {
              value = $reply_text_d|split:"__OWNER_REASSIGN_JOB__"
            }
          
            var $orj_json_raw {
              value = $orj_parts|get:1|trim
            }
          
            var $orj_data {
              value = $orj_json_raw|json_decode
            }
          
            conditional {
              if (($tech.id == 1) && ($orj_data != null) && ($orj_data.job_id != null) && ($orj_data.new_tech_id != null)) {
                db.get jobs {
                  field_name = "id"
                  field_value = $orj_data.job_id
                } as $orj_job
              
                db.get technicians {
                  field_name = "id"
                  field_value = $orj_data.new_tech_id
                } as $orj_new_tech
              
                conditional {
                  if (($orj_job != null) && ($orj_new_tech != null) && $orj_new_tech.active) {
                    var $orj_old_tech_id {
                      value = ($orj_job.technician_id ?? 0)
                    }
                  
                    db.edit jobs {
                      field_name = "id"
                      field_value = $orj_data.job_id
                      data = {technician_id: $orj_data.new_tech_id}
                    } as $orj_updated
                  
                    db.add event_log {
                      data = {
                        action  : "owner_reassign_job"
                        metadata: {
                        job_id     : $orj_data.job_id
                        old_tech_id: $orj_old_tech_id
                        new_tech_id: $orj_data.new_tech_id
                        reason     : ($orj_data.reason ?? "")
                        changed_by : $tech.id
                      }
                      }
                    } as $orj_log
                  
                    // Notify the new tech (always — they need to know they got a job).
                    conditional {
                      if (($orj_new_tech.phone ? "" : ) != "") {
                        var $orj_new_body {
                          value = "yo, teddy gave you job " ~ ($orj_data.job_id|to_text) ~ ". reason: " ~ ($orj_data.reason ?? "(none)")
                        }
                      
                        // ── SMS_ENABLED gate (call_site: tech_sms_inbound_POST.xs:1433) ──
                        var $gate1433_recipient_e164 {
                          value = "+1" ~ $orj_new_tech.phone
                        }
                      
                        var $gate1433_is_owner {
                          value = ($gate1433_recipient_e164 == "+16154855795") || ($orj_new_tech.phone == "6154855795")
                        }
                      
                        var $gate1433_sms_enabled {
                          value = (($env.SMS_ENABLED ?? "false") == "true")
                        }
                      
                        var $gate1433_should_send {
                          value = $gate1433_sms_enabled || $gate1433_is_owner
                        }
                      
                        conditional {
                          if ($gate1433_should_send == false) {
                            db.add event_log {
                              data = {
                                action  : "sms_gated"
                                metadata: {
                                recipient   : $gate1433_recipient_e164
                                body_preview: $orj_new_body|substr:0:200
                                gated_reason: "SMS_ENABLED=false, non-owner recipient"
                                call_site   : "tech_sms_inbound_POST.xs:1433"
                                job_id      : $orj_data.job_id
                              }
                              }
                            } as $gate1433_log
                          }
                        
                          else {
                            conditional {
                              if ($gate1433_is_owner && $gate1433_sms_enabled == false) {
                                db.add event_log {
                                  data = {
                                    action  : "sms_owner_bypass"
                                    metadata: {
                                    recipient   : $gate1433_recipient_e164
                                    body_preview: $orj_new_body|substr:0:200
                                    call_site   : "tech_sms_inbound_POST.xs:1433"
                                    job_id      : $orj_data.job_id
                                  }
                                  }
                                } as $bypass1433_log
                              }
                            }
                          
                            api.request {
                              url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                              method = "POST"
                              params = {
                                From: "+17273508487"
                                To  : "+1" ~ $orj_new_tech.phone
                                Body: $orj_new_body
                              }
                            
                              headers = [
                                "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                                "Content-Type: application/x-www-form-urlencoded"
                              ]
                            } as $orj_new_sms
                          }
                        }
                      }
                    }
                  
                    // Notify the old tech if there was one.
                    conditional {
                      if ($orj_old_tech_id > 0 && $orj_old_tech_id != $orj_data.new_tech_id) {
                        db.get technicians {
                          field_name = "id"
                          field_value = $orj_old_tech_id
                        } as $orj_old_tech
                      
                        conditional {
                          if (($orj_old_tech != null) && (($orj_old_tech.phone ? "" : ) != "")) {
                            var $orj_old_body {
                              value = "heads up, teddy reassigned job " ~ ($orj_data.job_id|to_text) ~ " off your plate. reason: " ~ ($orj_data.reason ?? "(none)")
                            }
                          
                            // ── SMS_ENABLED gate (call_site: tech_sms_inbound_POST.xs:1462) ──
                            var $gate1462_recipient_e164 {
                              value = "+1" ~ $orj_old_tech.phone
                            }
                          
                            var $gate1462_is_owner {
                              value = ($gate1462_recipient_e164 == "+16154855795") || ($orj_old_tech.phone == "6154855795")
                            }
                          
                            var $gate1462_sms_enabled {
                              value = (($env.SMS_ENABLED ?? "false") == "true")
                            }
                          
                            var $gate1462_should_send {
                              value = $gate1462_sms_enabled || $gate1462_is_owner
                            }
                          
                            conditional {
                              if ($gate1462_should_send == false) {
                                db.add event_log {
                                  data = {
                                    action  : "sms_gated"
                                    metadata: {
                                    recipient   : $gate1462_recipient_e164
                                    body_preview: $orj_old_body|substr:0:200
                                    gated_reason: "SMS_ENABLED=false, non-owner recipient"
                                    call_site   : "tech_sms_inbound_POST.xs:1462"
                                    job_id      : $orj_data.job_id
                                  }
                                  }
                                } as $gate1462_log
                              }
                            
                              else {
                                conditional {
                                  if ($gate1462_is_owner && $gate1462_sms_enabled == false) {
                                    db.add event_log {
                                      data = {
                                        action  : "sms_owner_bypass"
                                        metadata: {
                                        recipient   : $gate1462_recipient_e164
                                        body_preview: $orj_old_body|substr:0:200
                                        call_site   : "tech_sms_inbound_POST.xs:1462"
                                        job_id      : $orj_data.job_id
                                      }
                                      }
                                    } as $bypass1462_log
                                  }
                                }
                              
                                api.request {
                                  url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                                  method = "POST"
                                  params = {
                                    From: "+17273508487"
                                    To  : "+1" ~ $orj_old_tech.phone
                                    Body: $orj_old_body
                                  }
                                
                                  headers = [
                                    "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                                    "Content-Type: application/x-www-form-urlencoded"
                                  ]
                                } as $orj_old_sms
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          
            // Strip token block (split-on-token + rejoin).
            var $orj_strip_parts {
              value = $clean_reply_d|split:"__OWNER_REASSIGN_JOB__"
            }
          
            conditional {
              if (($orj_strip_parts|count) >= 3) {
                var.update $clean_reply_d {
                  value = `($orj_strip_parts|get:0) ~ ($orj_strip_parts|get:2)`
                }
              }
            }
          }
        }
      
        // 9. __OWNER_OVERRIDE_AVAILABILITY__ (Phase 8: owner can mark any tech in/out)
        conditional {
          if ($reply_text_d|contains:"__OWNER_OVERRIDE_AVAILABILITY__") {
            var $ooa_parts {
              value = $reply_text_d
                |split:"__OWNER_OVERRIDE_AVAILABILITY__"
            }
          
            var $ooa_json_raw {
              value = $ooa_parts|get:1|trim
            }
          
            var $ooa_data {
              value = $ooa_json_raw|json_decode
            }
          
            conditional {
              if (($tech.id == 1) && ($ooa_data != null) && ($ooa_data.tech_id != null) && ($ooa_data.date != null)) {
                db.get technicians {
                  field_name = "id"
                  field_value = $ooa_data.tech_id
                } as $ooa_target_tech
              
                conditional {
                  if (($ooa_target_tech != null) && $ooa_target_tech.active) {
                    var $ooa_is_off {
                      value = ($ooa_data.available == false) ? true : false
                    }
                  
                    db.query tech_availability {
                      where = $db.tech_availability.technician_id == $ooa_data.tech_id && $db.tech_availability.blocked_date == $ooa_data.date
                      return = {type: "single"}
                    } as $ooa_existing
                  
                    conditional {
                      if ($ooa_existing != null) {
                        db.edit tech_availability {
                          field_name = "id"
                          field_value = $ooa_existing.id
                          data = {
                            full_day_off: $ooa_is_off
                            reason      : ($ooa_data.reason ?? "owner override")
                          }
                        } as $ooa_updated
                      }
                    
                      else {
                        db.add tech_availability {
                          data = {
                            technician_id: $ooa_data.tech_id
                            blocked_date : $ooa_data.date
                            full_day_off : $ooa_is_off
                            reason       : ($ooa_data.reason ?? "owner override")
                            start_time   : "08:00"
                            end_time     : "16:00"
                          }
                        } as $ooa_new
                      }
                    }
                  
                    db.add event_log {
                      data = {
                        action  : "owner_override_availability"
                        metadata: {
                        tech_id   : $ooa_data.tech_id
                        date      : $ooa_data.date
                        available : ($ooa_data.available ?? false)
                        reason    : ($ooa_data.reason ?? "")
                        changed_by: $tech.id
                      }
                      }
                    } as $ooa_log
                  
                    // Notify the affected tech.
                    conditional {
                      if (($ooa_target_tech.phone ? "" : ) != "") {
                        var $ooa_status_word {
                          value = ($ooa_is_off == true) ? "out" : "in"
                        }
                      
                        var $ooa_body {
                          value = "yo, teddy marked you " ~ $ooa_status_word ~ " on " ~ $ooa_data.date ~ ". reason: " ~ ($ooa_data.reason ?? "(none)")
                        }
                      
                        // ── SMS_ENABLED gate (call_site: tech_sms_inbound_POST.xs:1577) ──
                        var $gate1577_recipient_e164 {
                          value = "+1" ~ $ooa_target_tech.phone
                        }
                      
                        var $gate1577_is_owner {
                          value = ($gate1577_recipient_e164 == "+16154855795") || ($ooa_target_tech.phone == "6154855795")
                        }
                      
                        var $gate1577_sms_enabled {
                          value = (($env.SMS_ENABLED ?? "false") == "true")
                        }
                      
                        var $gate1577_should_send {
                          value = $gate1577_sms_enabled || $gate1577_is_owner
                        }
                      
                        conditional {
                          if ($gate1577_should_send == false) {
                            db.add event_log {
                              data = {
                                action  : "sms_gated"
                                metadata: {
                                recipient     : $gate1577_recipient_e164
                                body_preview  : $ooa_body|substr:0:200
                                gated_reason  : "SMS_ENABLED=false, non-owner recipient"
                                call_site     : "tech_sms_inbound_POST.xs:1577"
                                target_tech_id: $ooa_target_tech.id
                              }
                              }
                            } as $gate1577_log
                          }
                        
                          else {
                            conditional {
                              if ($gate1577_is_owner && $gate1577_sms_enabled == false) {
                                db.add event_log {
                                  data = {
                                    action  : "sms_owner_bypass"
                                    metadata: {
                                    recipient     : $gate1577_recipient_e164
                                    body_preview  : $ooa_body|substr:0:200
                                    call_site     : "tech_sms_inbound_POST.xs:1577"
                                    target_tech_id: $ooa_target_tech.id
                                  }
                                  }
                                } as $bypass1577_log
                              }
                            }
                          
                            api.request {
                              url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
                              method = "POST"
                              params = {
                                From: "+17273508487"
                                To  : "+1" ~ $ooa_target_tech.phone
                                Body: $ooa_body
                              }
                            
                              headers = [
                                "Authorization: Basic " ~ (($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode)
                                "Content-Type: application/x-www-form-urlencoded"
                              ]
                            } as $ooa_sms
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          
            var $ooa_strip_parts {
              value = $clean_reply_d
                |split:"__OWNER_OVERRIDE_AVAILABILITY__"
            }
          
            conditional {
              if (($ooa_strip_parts|count) >= 3) {
                var.update $clean_reply_d {
                  value = `($ooa_strip_parts|get:0) ~ ($ooa_strip_parts|get:2)`
                }
              }
            }
          }
        }
      
        // 10. __OWNER_BROADCAST_CONTROL__ (Phase 8: owner can expire/rebroadcast)
        conditional {
          if ($reply_text_d|contains:"__OWNER_BROADCAST_CONTROL__") {
            var $obc_parts {
              value = $reply_text_d
                |split:"__OWNER_BROADCAST_CONTROL__"
            }
          
            var $obc_json_raw {
              value = $obc_parts|get:1|trim
            }
          
            var $obc_data {
              value = $obc_json_raw|json_decode
            }
          
            conditional {
              if (($tech.id == 1) && ($obc_data != null) && ($obc_data.action != null)) {
                conditional {
                  if (($obc_data.action == "expire") && ($obc_data.broadcast_id != null)) {
                    db.query broadcast_attempt {
                      where = $db.broadcast_attempt.id == $obc_data.broadcast_id && $db.broadcast_attempt.status == "open"
                      return = {type: "single"}
                    } as $obc_open_br
                  
                    conditional {
                      if ($obc_open_br != null) {
                        db.edit broadcast_attempt {
                          field_name = "id"
                          field_value = $obc_data.broadcast_id
                          data = {status: "expired"}
                        } as $obc_expired
                      
                        db.add event_log {
                          data = {
                            action  : "owner_broadcast_expired"
                            metadata: {
                            broadcast_id: $obc_data.broadcast_id
                            changed_by  : $tech.id
                          }
                          }
                        } as $obc_log
                      }
                    
                      else {
                        var.update $clean_reply_d {
                          value = $clean_reply_d ~ " (actually that broadcast wasn't open - may have already been claimed or canceled)"
                        }
                      }
                    }
                  }
                
                  else {
                    conditional {
                      if (($obc_data.action == "rebroadcast") && ($obc_data.job_id != null)) {
                        db.add scheduling_queue {
                          data = {
                            job_id     : $obc_data.job_id
                            action_type: "broadcast"
                            status     : "pending"
                          }
                        } as $obc_rebroadcast_queued
                      
                        db.add event_log {
                          data = {
                            action  : "owner_broadcast_rebroadcast"
                            metadata: {job_id: $obc_data.job_id, changed_by: $tech.id}
                          }
                        } as $obc_rb_log
                      }
                    }
                  }
                }
              }
            }
          
            var $obc_strip_parts {
              value = $clean_reply_d
                |split:"__OWNER_BROADCAST_CONTROL__"
            }
          
            conditional {
              if (($obc_strip_parts|count) >= 3) {
                var.update $clean_reply_d {
                  value = `($obc_strip_parts|get:0) ~ ($obc_strip_parts|get:2)`
                }
              }
            }
          }
        }
      
        // ── 5e. Final cleanup + set reply_to_send ──
        // After all token strips, if the visible reply is empty (Claude emitted
        // only token blocks with no surrounding prose), fall back to a generic
        // acknowledgment so the tech doesn't get a blank SMS.
        var.update $clean_reply_d {
          value = $clean_reply_d|trim
        }
      
        conditional {
          if ($clean_reply_d == "") {
            var.update $clean_reply_d {
              value = "got it"
            }
          }
        }
      
        var.update $reply_to_send {
          value = $clean_reply_d
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 7. Persist assistant message + bump conversation timestamp.
    // ────────────────────────────────────────────────────────
    db.add agent_message {
      data = {
        conversation_id: $conversation.id
        role           : "assistant"
        content        : $reply_to_send
      }
    } as $new_assistant_msg
  
    db.edit agent_conversation {
      field_name = "id"
      field_value = $conversation.id
      data = {last_message_at: now}
    } as $conv_updated
  
    return {
      value = {reply: $reply_to_send}
    }
  }

  response = null
  guid = "18gHz_EWoLHGe79tzs5DgPk0TAQ"
}