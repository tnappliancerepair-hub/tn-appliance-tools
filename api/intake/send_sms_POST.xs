//  send_sms wrapper. Refactored 2026-05-20 for Telnyx-primary, Twilio-failover
//  routing per docs/sms-architecture-2026-05-19.md and docs/send-sms-rewrite-spec.md.
// 
//  Caller-facing input contract preserved (legacy: customer_phone, customer_first_name,
//  job_number, to, message). Added body? as alias of message and context_tag? for
//  audit. Response shape is ADDITIVE: legacy twilio_sid / twilio_status fields stay
//  populated only on the Twilio failover path; new provider / provider_message_id /
//  provider_status fields populated on every send.
// 
//  Routing logic (Phase 1 ONLY, no LA branch yet):
//    1. SMS_ENABLED=false gate with owner-bypass on +16154855795 (preserved from
//       pre-refactor behavior, see docs/sms-enabled-gate-pattern.md).
//    2. Recipient is internal (technicians.phone match, OR hardcoded owner/Danielle)
//       => from_number = TELNYX_FROM_TECH (+16158578800).
//    3. Else => from_number = TELNYX_FROM_CUSTOMER (+16155889500).
//    4. SMS_PROVIDER env (default telnyx) routes to either Telnyx or Twilio path.
//    5. Twilio failover always sends FROM the single TWILIO_FROM_NUMBER regardless
//       of tech/customer classification (no parity numbers per Phase 1 decision).
// 
//  Logging: event_log gets one row per call. Actions:
//    sms_gated            -> SMS_ENABLED=false, non-owner, no send
//    sms_owner_bypass     -> SMS_ENABLED=false but owner, send happened
//    sms_sent             -> normal send attempt (metadata.success indicates outcome)
//    sms_provider_unknown -> SMS_PROVIDER is neither telnyx nor twilio
// 
//  XanoScript rules followed (genealogy v1 section 16):
//    - no try/catch (conditional branches instead)
//    - no em dashes in code or strings
//    - literal-array headers (|push two-arg form silently drops)
//    - var.update for mutations of vars declared outside the conditional
//    - static Telnyx URL (env-in-url is unreliable; env vars go in headers/params only)
//    - regex_replace only for single-line char-class patterns
// 
//  Required env vars:
//    SMS_ENABLED              true|false (master kill switch)
//    SMS_PROVIDER             telnyx|twilio (default telnyx)
//    TELNYX_API_KEY           bearer token
//    TELNYX_PROFILE_ID        messaging profile UUID
//    TELNYX_FROM_CUSTOMER     +16155889500
//    TELNYX_FROM_TECH         +16158578800
//    TWILIO_ACCOUNT_SID       (failover)
//    TWILIO_AUTH_TOKEN        (failover)
//    TWILIO_FROM_NUMBER       (failover, single number)
query send_sms verb=POST {
  api_group = "intake"

  input {
    text customer_phone?
    text customer_first_name?
    text job_number?
    text to?
    text message?
    text body?
    text context_tag?
  }

  stack {
    // ============================================================
    // 1. Resolve target phone and message body
    // ============================================================
    var $target_phone {
      value = $input.to ?? $input.customer_phone
    }
  
    // body? is an alias of message? (fixes pre-existing financial-endpoint
    // regression where callers passed 'body' but the endpoint only read 'message',
    // silently triggering the default template).
    var $sms_body {
      value = $input.message ?? ($input.body ?? ("Hi " ~ ($input.customer_first_name ?? "there") ~ "! We received your appliance repair request " ~ ($input.job_number ?? "") ~ ". We will contact you shortly to confirm your appointment. - TN Appliance Exchange"))
    }
  
    // ============================================================
    // 2. Phone normalization
    //    Strip non-digits, drop optional leading "1" country code,
    //    produce both bare 10-digit and E.164 forms for matching.
    // ============================================================
    var $p_raw {
      value = ($target_phone ?? "")|trim
    }
  
    // 2026-05-20 fix: regex_replace returns null in this Xano runtime
    // regardless of pattern (Footgun #28 — see ahs_email_intake_POST.xs
    // comments around lines 517, 798, 944, 991). Original broken line was:
    //   value = $p_raw|regex_replace:"[^0-9]":""
    // which silently set $p_digits = null/empty, propagating to $p10 = ""
    // and $p_e164 = "+1", which made $is_owner false for owner cell and
    // misrouted every Telnyx outbound to TELNYX_FROM_CUSTOMER.
    // Fix: chained |replace: calls to strip the common non-digit chars
    // (plus, dash, space, parens, dot). Same workaround pattern the team
    // adopted for ahs_email_intake's phone normalization.
    var $p_digits {
      value = $p_raw
        |replace:"+":""
        |replace:"-":""
        |replace:" ":""
        |replace:"(":""
        |replace:")":""
        |replace:".":""
    }
  
    var $p_len {
      value = $p_digits|strlen
    }
  
    var $p10 {
      value = (($p_len == 11) && (($p_digits|substr:0:1) == "1")) ? ($p_digits|substr:1:10) : $p_digits
    }
  
    var $p_e164 {
      value = "+1" ~ $p10
    }
  
    // ============================================================
    // 3. Recipient classification
    //    Internal if technicians.phone matches any common format OR
    //    if recipient is owner (+16154855795) or Danielle (+16154850713).
    // ============================================================
    // db.query with expression-style where: see
    // xano-workspace/api/admin/sms_enabled_status_GET.xs for the canonical
    // pattern. SQL-style "?" placeholders + params arrays do NOT parse;
    // values inline directly into the expression instead.
    var $p_w_country {
      value = "1" ~ $p10
    }
  
    db.query technicians {
      where = ($db.technicians.phone == $p10) || ($db.technicians.phone == $p_e164) || ($db.technicians.phone == $p_w_country)
      return = {type: "list"}
    } as $tech_match_rows
  
    var $is_tech_phone {
      value = (($tech_match_rows ?? [])|count) > 0
    }
  
    // Hardcoded internal staff (owner + Danielle). Matched against the bare
    // 10-digit form so any caller-side format (E.164, dashed, raw) classifies
    // correctly.
    var $is_owner {
      value = ($p10 == "6154855795")
    }
  
    var $is_danielle {
      value = ($p10 == "6154850713")
    }

    // Office staff (not field techs, so not in the technicians table): Carrie
    // (handles all returns, helps the LA guys) + Sofia. Internal recipients —
    // their alerts (returns, board, welcome) must bypass the customer gate.
    var $is_office_staff {
      value = ($p10 == "2258035669") || ($p10 == "6292594602")
    }

    var $is_internal {
      value = ($is_tech_phone == true) || ($is_owner == true) || ($is_danielle == true) || ($is_office_staff == true)
    }
  
    // ============================================================
    // 4. From-number selection
    //    Internal recipients ship from the tech/internal Telnyx number.
    //    Everyone else ships from the customer Telnyx number.
    //    No LA routing in Phase 1.
    // ============================================================
    // Teddy 2026-08-12: two approved Telnyx lines are the primaries — customer on
    // TELNYX_FROM_CUSTOMER (+16155889500), techs/internal on TELNYX_FROM_TECH
    // (the approved tech line +16158578800). Twilio stays as the FALLBACK
    // (SMS_PROVIDER=twilio, section 8b) in case of issues with these numbers.
    // Safety: if the tech env var is empty OR still the old UNREGISTERED penalty
    // line (+16157575500), route from the approved +16158578800 so pre-diagnosis
    // links never ship from a throttled/unregistered number. Any other value the
    // env is set to (another approved line) is honored.
    var $tech_env {
      value = ($env.TELNYX_FROM_TECH ?? "")|trim
    }

    var $internal_from {
      value = (($tech_env == "") || ($tech_env == "+16157575500")) ? "+16158578800" : $tech_env
    }

    var $from_number_telnyx {
      value = ($is_internal == true) ? $internal_from : $env.TELNYX_FROM_CUSTOMER
    }
  
    // ============================================================
    // 5. SMS_ENABLED gate with owner bypass
    //    Preserves pre-refactor behavior: owner alerts fire even when the
    //    master switch is off. Anything not literal "true" treated as off.
    // ============================================================
    var $sms_enabled {
      value = (($env.SMS_ENABLED ?? "false") == "true")
    }
  
    var $should_send {
      value = ($sms_enabled == true) || ($is_owner == true)
    }
  
    // ============================================================
    // 5b. CUSTOMER_FACING_ENABLED gate — parallel-mode safety net
    //     For customer-direction sends (not internal staff): drop + log
    //     when env flag is not "true". This is the hard rule from the
    //     parallel-launch brief — zero customer messages from the new
    //     system until explicitly enabled.
    // ============================================================
    // Read the override from company_settings first (set via Office Today
    // toggle). Falls back to env var if no row exists. This makes the
    // gate flippable without a Xano UI env edit.
    db.query company_settings {
      where = $db.company_settings.company_id == 1 && $db.company_settings.setting_key == "customer_facing_enabled"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $gate_setting_rows
  
    var $gate_setting {
      value = (($gate_setting_rows.items|first) ?? null)
    }
  
    var $gate_setting_val {
      value = ($gate_setting != null) ? (($gate_setting.setting_value ?? "")|trim|to_lower) : ""
    }
  
    var $env_gate {
      value = (($env.CUSTOMER_FACING_ENABLED ?? "false") == "true")
    }
  
    var $customer_facing_enabled {
      value = ($gate_setting_val != "") ? ($gate_setting_val == "true") : $env_gate
    }

    // ============================================================
    // 5c. TEST ALLOWLIST — lets specific consenting numbers receive REAL
    //     customer-direction texts while the global gate stays OFF for every
    //     actual customer. Set via company_settings key "sms_test_allowlist"
    //     (bare 10-digit numbers, comma/space separated). Delete the row to
    //     end testing. Sends still ship from the customer Telnyx number so the
    //     tester sees exactly what a real customer would.
    // ============================================================
    db.query company_settings {
      where = $db.company_settings.company_id == 1 && $db.company_settings.setting_key == "sms_test_allowlist"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $test_allow_rows

    var $test_allow_row {
      value = (($test_allow_rows.items|first) ?? null)
    }

    var $test_allow_val {
      value = ($test_allow_row != null) ? (($test_allow_row.setting_value ?? "")|trim) : ""
    }

    var $is_test_recipient {
      value = ($test_allow_val != "" && $p10 != "") ? ($test_allow_val|contains:$p10) : false
    }

    conditional {
      if ($is_internal == false && $customer_facing_enabled == false && $is_test_recipient == false) {
        // Drop + log loudly
        db.add event_log {
          data = {
            action  : "dropped_customer_sms"
            metadata: {
            recipient_last4: ($p10 != "") ? ($p10|substr:6:4) : "?"
            context_tag    : ($input.context_tag ?? "")
            body_preview   : (($sms_body ?? "")|substr:0:80)
            reason         : "CUSTOMER_FACING_ENABLED=false"
          }
          }
        } as $drop_log
      
        // Drop is logged to event_log above. No SMS alert — that was
        // causing per-drop spam to Teddy's phone (every gated customer
        // outbound = 1 SMS). Visibility lives in office-pulse instead.
        // If we ever want a daily digest of dropped counts, build it as
        // a separate scheduled summary, not per-drop.
      
        return {
          value = ```
            {
              success            : false
              provider           : "gated"
              provider_message_id: null
              provider_status    : null
              twilio_sid         : null
              twilio_status      : 0
              error              : "dropped_customer_facing_disabled"
              gated              : true
            }
            ```
        }
      }
    }
  
    // ============================================================
    // 5d. INTAKE-ONLY GATE (Teddy 2026-07-14: "eliminate all texts other than
    //     intake and availability"). THE hard chokepoint EVERY sender passes
    //     through (Netlify, tech-app taps, colony loop, XS), so appointment
    //     confirmations, on-the-way/arrived, reminders, reschedule, review asks,
    //     etc. are DROPPED no matter which code path fires them. Internal staff
    //     (tech/owner/office) bypass via $is_internal above. Allowed customer
    //     tags: intake / availability / media / model / video, reactive replies
    //     (translated / reply / inbound / new_lead), opt-out confirmations, and a
    //     human tech texting his own job's customer (tech_field). Untagged or
    //     unknown customer sends are blocked by default (safe). Flippable OFF via
    //     company_settings key "intake_only_gate" = "false" if ever needed.
    // ============================================================
    db.query company_settings {
      where = $db.company_settings.company_id == 1 && $db.company_settings.setting_key == "intake_only_gate"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $intake_gate_rows

    var $intake_gate_row {
      value = (($intake_gate_rows.items|first) ?? null)
    }

    var $intake_gate_on {
      value = ($intake_gate_row != null) ? ((($intake_gate_row.setting_value ?? "")|trim|to_lower) != "false") : true
    }

    var $tag_l {
      value = (($input.context_tag ?? "")|trim|to_lower)
    }

    // BODY-BASED INTAKE ALLOW (Teddy 2026-07-24: "confirm this text is going to the
    // customer — without the intake text none of this works"). The Mac loop's instant
    // new-job greeting sends context nested as {action:...} with NO top-level
    // context_tag, so the tag reads empty and the gate was silently blocking every
    // instant intake link (27+/3d in sms_blocked_non_intake). The bulletproof signal:
    // any customer text that CARRIES an intake link IS the intake text. This CANNOT
    // leak the killed clock-time "confirmed for 2:00 PM" / "coming Monday" texts —
    // those have no link. Covers the warranty-intake, customer-portal, appliance-ai,
    // and finish-upload flows regardless of how the sender tagged (or didn't tag) it.
    var $body_l {
      value = (($sms_body ?? "")|to_lower)
    }

    var $body_is_intake {
      value = ($body_l|contains:"warranty-intake") || ($body_l|contains:"customer-portal") || ($body_l|contains:"appliance-ai") || ($body_l|contains:"finish-upload")
    }

    // EN-ROUTE + ARRIVED (Teddy 2026-07-24: "those two are fine to text the customer").
    // Tech-tap real-time status the customer is expecting — allow by tag (en_route /
    // arrival) or by body phrase as a backstop. No clock times (the en-route sender now
    // sends the plain "on the way, see you soon" version). Cannot leak the killed
    // "confirmed for 2:00 PM" / "coming Monday" texts.
    var $body_is_status {
      value = ($body_l|contains:"on the way") || ($body_l|contains:"has arrived") || ($body_l|contains:"is here")
    }

    var $tag_intake_ok {
      value = $body_is_intake || $body_is_status || ($tag_l|contains:"en_route") || ($tag_l|contains:"arriv") || ($tag_l|contains:"intake") || ($tag_l|contains:"availab") || ($tag_l|contains:"quick") || ($tag_l|contains:"finish") || ($tag_l|contains:"media") || ($tag_l|contains:"model") || ($tag_l|contains:"video") || ($tag_l|contains:"resume") || ($tag_l|contains:"reply") || ($tag_l|contains:"translated") || ($tag_l|contains:"inbound") || ($tag_l|contains:"new_lead") || ($tag_l|contains:"opt_out") || ($tag_l|contains:"opt_in") || ($tag_l|contains:"tech_field") || ($tag_l|contains:"satisfaction") || ($tag_l|contains:"review")
    }

    conditional {
      if ($is_internal == false && $intake_gate_on == true && $tag_intake_ok == false) {
        db.add event_log {
          data = {
            action  : "sms_blocked_non_intake"
            metadata: {
              recipient_last4: ($p10 != "") ? ($p10|substr:6:4) : "?"
              context_tag    : ($input.context_tag ?? "")
              body_preview   : (($sms_body ?? "")|substr:0:80)
              reason         : "intake_only_gate"
            }
          }
        } as $blk_log

        return {
          value = ```
            {
              success            : false
              provider           : "blocked_non_intake"
              provider_message_id: null
              provider_status    : null
              twilio_sid         : null
              twilio_status      : 0
              error              : "only_intake_availability_allowed"
              gated              : true
            }
            ```
        }
      }
    }

    // ============================================================
    // 5e. TECH-SMS CUTOFF (Teddy 2026-08-11: "no texts to techs except the new
    //     TDR / pre-diagnosis link that replaced the Teddy Tool text. All others
    //     eliminated starting now"). Field techs are internal, so they bypass the
    //     customer + intake gates above — gate them HERE. A field-tech recipient
    //     (in the technicians table, and NOT owner / Danielle / office staff) may
    //     ONLY receive a text that carries the TDR link (teddy-tdr-tool or the new
    //     cash-tdr page). Every other system->tech text is DROPPED regardless of
    //     source (Netlify fn, tech-app tap, colony loop, XS). Owner/office/Danielle
    //     alerts (money-in, etc.) are UNAFFECTED. Flip OFF via company_settings
    //     key "tech_sms_gate" = "false".
    // ============================================================
    var $is_field_tech {
      value = ($is_tech_phone == true) && ($is_owner == false) && ($is_danielle == false) && ($is_office_staff == false)
    }

    db.query company_settings {
      where = $db.company_settings.company_id == 1 && $db.company_settings.setting_key == "tech_sms_gate"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $tech_gate_rows

    var $tech_gate_row {
      value = (($tech_gate_rows.items|first) ?? null)
    }

    var $tech_gate_on {
      value = ($tech_gate_row != null) ? ((($tech_gate_row.setting_value ?? "")|trim|to_lower) != "false") : true
    }

    // The one allowed tech text = the pre-diagnosis / TDR link (current
    // teddy-tdr-tool.html, or the new cash-tdr.html it is being replaced with).
    // Body-based so it survives the repoint and can't be spoofed by a tag.
    var $tech_send_ok {
      value = ($body_l|contains:"teddy-tdr-tool") || ($body_l|contains:"cash-tdr")
    }

    conditional {
      if ($is_field_tech == true && $tech_gate_on == true && $tech_send_ok == false) {
        db.add event_log {
          data = {
            action  : "sms_blocked_tech"
            metadata: {
              recipient_last4: ($p10 != "") ? ($p10|substr:6:4) : "?"
              context_tag    : ($input.context_tag ?? "")
              body_preview   : (($sms_body ?? "")|substr:0:80)
              reason         : "tech_sms_gate: only TDR link allowed to techs"
            }
          }
        } as $tech_blk_log

        return {
          value = ```
            {
              success            : false
              provider           : "blocked_tech"
              provider_message_id: null
              provider_status    : null
              twilio_sid         : null
              twilio_status      : 0
              error              : "only_tdr_link_allowed_to_techs"
              gated              : true
            }
            ```
        }
      }
    }

    // ============================================================
    // 6. Initialize response vars (success-shaped default so the gated
    //    path returns the same contract as the live path).
    // ============================================================
    var $is_success {
      value = true
    }
  
    var $error_msg {
      value = null
    }
  
    var $provider_used {
      value = null
    }
  
    var $provider_message_id {
      value = null
    }
  
    var $provider_status {
      value = null
    }
  
    var $twilio_sid {
      value = null
    }
  
    var $twilio_status {
      value = 0
    }
  
    // ============================================================
    // 7. Provider selection
    //    Default telnyx. Anything other than telnyx or twilio is
    //    treated as a configuration error (logged + returned).
    // ============================================================
    var $sms_provider {
      value = (($env.SMS_PROVIDER ?? "telnyx")|trim)
    }
  
    var $is_telnyx {
      value = ($sms_provider == "telnyx")
    }
  
    var $is_twilio {
      value = ($sms_provider == "twilio")
    }
  
    // ============================================================
    // 8. Send path
    // ============================================================
    conditional {
      if ($should_send == false) {
        // Skip send. Caller still receives success-shaped response per
        // pre-refactor contract.
        db.add event_log {
          data = {
            action  : "sms_gated"
            metadata: {
            recipient   : $p_e164
            body_preview: $sms_body|substr:0:200
            gated_reason: "SMS_ENABLED=false, non-owner recipient"
            context_tag : ($input.context_tag ?? null)
            call_site   : "send_sms_POST.xs:gate"
          }
          }
        } as $gate_log
      }
    
      else {
        // Owner-bypass audit (only when SMS is off but owner is being
        // contacted anyway). When SMS is on, this is normal traffic and
        // no bypass log is written.
        conditional {
          if ($is_owner && ($sms_enabled == false)) {
            db.add event_log {
              data = {
                action  : "sms_owner_bypass"
                metadata: {
                recipient   : $p_e164
                body_preview: $sms_body|substr:0:200
                context_tag : ($input.context_tag ?? null)
                call_site   : "send_sms_POST.xs:bypass"
              }
              }
            } as $bypass_log
          }
        }
      
        // ------------------------------------------------------------
        // 8a. Telnyx path (PRIMARY)
        // ------------------------------------------------------------
        conditional {
          if ($is_telnyx) {
            var $telnyx_auth_header {
              value = "Bearer " ~ $env.TELNYX_API_KEY
            }
          
            api.request {
              url = "https://api.telnyx.com/v2/messages"
              method = "POST"
              params = {
                from                : $from_number_telnyx
                to                  : $target_phone
                text                : $sms_body
                messaging_profile_id: $env.TELNYX_PROFILE_ID
              }
            
              headers = [
                "Content-Type: application/json"
                "Authorization: " ~ $telnyx_auth_header
              ]
            } as $telnyx_response
          
            // Telnyx returns 200 with { data: { id, to: [{status}], ... } } on
            // queued. Errors return 4xx with { errors: [{code, title, detail}] }.
            var $telnyx_http {
              value = ($telnyx_response.response.status ?? 0)
            }
          
            var $telnyx_data {
              value = ($telnyx_response.response.result.data ?? null)
            }
          
            var $telnyx_first_to_status {
              value = ($telnyx_data.to[0].status ?? null)
            }
          
            var $telnyx_first_error {
              value = ($telnyx_response.response.result.errors[0] ?? null)
            }
          
            var $telnyx_error_detail {
              value = (($telnyx_first_error.detail ?? null) ?? ($telnyx_first_error.title ?? "telnyx call failed"))
            }
          
            var.update $provider_used {
              value = "telnyx"
            }
          
            var.update $is_success {
              value = (($telnyx_http >= 200) && ($telnyx_http < 300))
            }
          
            var.update $provider_message_id {
              value = ($telnyx_data.id ?? null)
            }
          
            var.update $provider_status {
              value = $telnyx_first_to_status
            }
          
            var.update $error_msg {
              value = ($is_success == true) ? null : $telnyx_error_detail
            }
          }
        
          // ------------------------------------------------------------
          // 8b. Twilio path (FAILOVER)
          //     Always uses the single TWILIO_FROM_NUMBER regardless of
          //     internal-vs-customer classification (Phase 1 decision: no
          //     parity numbers for the failover path).
          // ------------------------------------------------------------
          elseif ($is_twilio) {
            var $twilio_auth_b64 {
              value = ($env.TWILIO_ACCOUNT_SID ~ ":" ~ $env.TWILIO_AUTH_TOKEN)|base64_encode
            }
          
            var $twilio_auth_header {
              value = "Basic " ~ $twilio_auth_b64
            }
          
            api.request {
              url = "https://api.twilio.com/2010-04-01/Accounts/" ~ $env.TWILIO_ACCOUNT_SID ~ "/Messages.json"
              method = "POST"
              params = {}
                |set:"To":$target_phone
                |set:"From":$env.TWILIO_FROM_NUMBER
                |set:"Body":$sms_body
              headers = [
                "Content-Type: application/x-www-form-urlencoded"
                "Authorization: " ~ $twilio_auth_header
              ]
            } as $twilio_api_response
          
            var $tw_http {
              value = ($twilio_api_response.response.status ?? 0)
            }
          
            var $tw_sid {
              value = ($twilio_api_response.response.result.sid ?? null)
            }
          
            var $tw_status_field {
              value = ($twilio_api_response.response.result.status ?? null)
            }
          
            var $tw_err_message {
              value = (($twilio_api_response.response.result.message ?? null) ?? ($twilio_api_response.response.error.message ?? "twilio call failed"))
            }
          
            var.update $provider_used {
              value = "twilio"
            }
          
            var.update $is_success {
              value = ($tw_http == 201)
            }
          
            var.update $provider_message_id {
              value = $tw_sid
            }
          
            var.update $provider_status {
              value = $tw_status_field
            }
          
            var.update $twilio_sid {
              value = $tw_sid
            }
          
            var.update $twilio_status {
              value = $tw_http
            }
          
            var.update $error_msg {
              value = ($is_success == true) ? null : $tw_err_message
            }
          }
        
          // ------------------------------------------------------------
          // 8c. Unknown provider value
          // ------------------------------------------------------------
          else {
            var.update $is_success {
              value = false
            }
          
            var.update $error_msg {
              value = "unknown SMS_PROVIDER: " ~ $sms_provider
            }
          
            var.update $provider_used {
              value = $sms_provider
            }
          
            db.add event_log {
              data = {
                action  : "sms_provider_unknown"
                metadata: {
                recipient   : $p_e164
                body_preview: $sms_body|substr:0:200
                provider    : $sms_provider
                context_tag : ($input.context_tag ?? null)
                call_site   : "send_sms_POST.xs:provider"
              }
              }
            } as $unknown_log
          }
        }
      
        // ------------------------------------------------------------
        // 8d. Per-send audit log
        //     One row per send attempt (success or failure). Skipped sends
        //     already logged via sms_gated above.
        // ------------------------------------------------------------
        db.add event_log {
          data = {
            action  : "sms_sent"
            metadata: {
            recipient          : $p_e164
            recipient_class    : ($is_internal == true) ? "internal" : "customer"
            from_number        : ($is_telnyx == true) ? $from_number_telnyx : (($is_twilio == true) ? $env.TWILIO_FROM_NUMBER : null)
            provider           : $provider_used
            provider_message_id: $provider_message_id
            provider_status    : $provider_status
            success            : $is_success
            body_preview       : $sms_body|substr:0:200
            context_tag        : ($input.context_tag ?? null)
            error_msg          : $error_msg
            call_site          : "send_sms_POST.xs:send"
          }
          }
        } as $send_log
      }
    }
  }

  response = {
    success            : $is_success
    provider           : $provider_used
    provider_message_id: $provider_message_id
    provider_status    : $provider_status
    twilio_sid         : $twilio_sid
    twilio_status      : $twilio_status
    error              : $error_msg
  }

  guid = "Z57b0Yxp3ilFj7HeloYnRI0_imw"
}