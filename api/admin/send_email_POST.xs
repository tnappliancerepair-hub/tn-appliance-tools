//  Internal email wrapper. Callers across the workspace POST here to
//  send transactional email (Phase A1 use case: dedup-fail alerts to
//  Danielle when ServicePower parser can't resolve a customer).
// 
//  Mirrors the send_sms_POST.xs pattern:
//    - Gated by $env.EMAIL_ENABLED (must equal "true" to send)
//    - When gated: logs to event_log + returns success-shaped response
//      (caller doesn't branch on enabled vs gated — same contract either way)
//    - When enabled: forwards to Netlify send-email function with the
//      EMAIL_SHARED_SECRET in X-Internal-Auth header
// 
//  Defense-in-depth: BOTH this Xano-side gate AND the Netlify-side
//  EMAIL_ENABLED gate must pass for an email to actually fire. Flipping
//  either to "false" stops sends. The Netlify-side dry-run is the
//  belt-and-suspenders fallback.
// 
//  Required Xano env vars:
//    EMAIL_ENABLED            // "true" to actually send; else gated
//    EMAIL_SHARED_SECRET      // bearer for X-Internal-Auth header (matches Netlify)
// 
//  Live URL (after Netlify deploy):
//    https://superlative-naiad-233aa7.netlify.app/.netlify/functions/send-email
query send_email verb=POST {
  api_group = "admin"

  input {
    text to
    text subject
    text body
    text? replyTo?
  }

  stack {
    // ─── PRE-FLIGHT ─────────────────────────────────────────────
    precondition ($input.to != null && $input.to != "") {
      error_type = "inputerror"
      error = "to is required"
    }
  
    precondition ($input.subject != null && $input.subject != "") {
      error_type = "inputerror"
      error = "subject is required"
    }
  
    precondition ($input.body != null && $input.body != "") {
      error_type = "inputerror"
      error = "body is required"
    }
  
    // ─── GATE ───────────────────────────────────────────────────
    // $env.EMAIL_ENABLED must equal the literal string "true". Anything
    // else (unset, "false", "True", "1", etc.) → gated.
    var $gate_enabled {
      value = (($env.EMAIL_ENABLED ?? "false") == "true")
    }
  
    // Initialize response vars to a success-shaped default. The gated
    // path returns these unchanged (caller-friendly contract).
    var $is_success {
      value = true
    }
  
    var $message_id {
      value = null
    }
  
    var $mode {
      value = "gated"
    }
  
    var $error_msg {
      value = null
    }
  
    var $netlify_status {
      value = 0
    }
  
    conditional {
      if ($gate_enabled == false) {
        // Gated path: log + return without calling Netlify.
        db.add event_log {
          data = {
            action  : "email_gated"
            metadata: {
            to          : $input.to
            subject     : $input.subject
            body_preview: $input.body|substr:0:200
            reply_to    : ($input.replyTo ?? "tnappliancerepair@gmail.com")
            gated_reason: "EMAIL_ENABLED != 'true'"
            call_site   : "send_email_POST.xs:gate"
          }
          }
        } as $gate_log
      }
    
      else {
        // Live path: forward to Netlify send-email.
        var.update $mode {
          value = "live"
        }
      
        api.request {
          url = "https://superlative-naiad-233aa7.netlify.app/.netlify/functions/send-email"
          method = "POST"
          params = {
            to     : $input.to
            subject: $input.subject
            body   : $input.body
            replyTo: ($input.replyTo ?? "tnappliancerepair@gmail.com")
          }
        
          headers = [
            "Content-Type: application/json"
            "X-Internal-Auth: " ~ $env.EMAIL_SHARED_SECRET
          ]
        
          timeout = 30
        } as $netlify_resp
      
        var.update $netlify_status {
          value = ($netlify_resp.response.status ?? 0)
        }
      
        var $netlify_ok {
          value = ($netlify_resp.response.result.ok ?? false)
        }
      
        var $netlify_message_id {
          value = ($netlify_resp.response.result.messageId ?? null)
        }
      
        var $netlify_mode {
          value = ($netlify_resp.response.result.mode ?? "unknown")
        }
      
        var $netlify_error {
          value = ($netlify_resp.response.result.error ?? null)
        }
      
        var.update $is_success {
          value = ($netlify_status == 200) && ($netlify_ok == true)
        }
      
        var.update $message_id {
          value = $netlify_message_id
        }
      
        // If Netlify also gated (e.g. EMAIL_ENABLED unset on Netlify side
        // even though Xano-side is "true"), pass through their mode label.
        conditional {
          if ($netlify_mode == "dry-run") {
            var.update $mode {
              value = "netlify_dry_run"
            }
          }
        }
      
        var.update $error_msg {
          value = $is_success ? null : ($netlify_error ?? "send-email call failed")
        }
      
        // Audit row — captures both success and failure paths.
        var $action_name {
          value = "email_sent"
        }
      
        conditional {
          if ($is_success == false) {
            var.update $action_name {
              value = "email_failed"
            }
          }
        }
      
        db.add event_log {
          data = {
            action  : $action_name
            metadata: {
            to            : $input.to
            subject       : $input.subject
            body_preview  : $input.body|substr:0:200
            reply_to      : ($input.replyTo ?? "tnappliancerepair@gmail.com")
            message_id    : $message_id
            mode          : $mode
            netlify_status: $netlify_status
            error         : $error_msg
            call_site     : "send_email_POST.xs:live"
          }
          }
        } as $audit_log
      }
    }
  }

  response = {
    success   : $is_success
    message_id: $message_id
    mode      : $mode
    error     : $error_msg
  }

  guid = "send-email-2026-05-12"
}