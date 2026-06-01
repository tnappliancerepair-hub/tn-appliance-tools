//  Admin status endpoint for the SMS_ENABLED master kill-switch.
//  Returns the current state of $env.SMS_ENABLED + 24-hour counts of
//  gated sends, owner-bypass sends, and the last 10 gated sends with
//  their call_site identifiers for grep-back to the source file.
// 
//  Per docs/sms-enabled-gate-pattern.md / docs/system-blueprint-decisions-2026-05-09.md Decision 6.
// 
//  Requires: an "admin" API group in Xano. If the admin group does not
//  exist yet, create it via the Xano dashboard before pushing this file.
query sms_enabled_status verb=GET {
  api_group = "admin"

  input {
  }

  stack {
    // 1. SMS_ENABLED flag — string "true" or anything-else.
    var $sms_enabled {
      value = (($env.SMS_ENABLED ?? "false") == "true")
    }
  
    // 2. 24-hour window cutoff.
    var $cutoff_24h {
      value = now|transform_timestamp:"-24 hours"
    }
  
    // 3. Gated sends in last 24 hours.
    db.query event_log {
      where = $db.event_log.action == "sms_gated" && $db.event_log.created_at > $cutoff_24h
      sort = {event_log.created_at: "desc"}
      return = {type: "list"}
    } as $gated_rows
  
    var $gated_count {
      value = ($gated_rows ?? [])|count
    }
  
    // 4. Owner-bypass sends in last 24 hours.
    db.query event_log {
      where = $db.event_log.action == "sms_owner_bypass" && $db.event_log.created_at > $cutoff_24h
      sort = {event_log.created_at: "desc"}
      return = {type: "list"}
    } as $bypass_rows
  
    var $bypass_count {
      value = ($bypass_rows ?? [])|count
    }
  
    // 5. Last 10 gated rows for the response — pick fields manually to avoid
    //    leaking unrelated event_log columns. Use foreach + push to keep
    //    arrays numerically indexed (per footgun #4 — never push:$variable;
    //    always object literals).
    var $last_gated {
      value = []
    }
  
    var $i {
      value = 0
    }
  
    foreach ($gated_rows) {
      each as $row {
        conditional {
          if ($i < 10) {
            var.update $last_gated {
              value = $last_gated
                |push:```
                  {
                    created_at  : $row.created_at,
                    recipient   : ($row.metadata.recipient ?? ""),
                    gated_reason: ($row.metadata.gated_reason ?? ""),
                    call_site   : ($row.metadata.call_site ?? ""),
                    body_preview: ($row.metadata.body_preview ?? "")
                  }
                  ```
            }
          
            var.update $i {
              value = $i + 1
            }
          }
        }
      }
    }
  }

  response = {
    sms_enabled                      : $sms_enabled
    env_var_raw                      : ($env.SMS_ENABLED ?? null)
    window                           : "last 24 hours"
    total_gated_sends_last_24h       : $gated_count
    total_owner_bypass_sends_last_24h: $bypass_count
    last_gated_sends                 : $last_gated
  }

  guid = "sms_enabled_status_v1_2026-05-11"
}