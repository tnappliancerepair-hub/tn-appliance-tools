//  One-tap toggle for the customer-facing SMS gate. Writes the
//  company_settings row (key=customer_facing_enabled) AND alerts Teddy
//  with an audit SMS so every flip is visible. Used by the Office Today
//  gate pill.
// 
//  Body: { enabled: true|false, actor: "office_today" }
query toggle_customer_sms_gate verb=POST {
  api_group = "intake"

  input {
    bool enabled
    text? actor?
  }

  stack {
    var $actor_clean {
      value = (($input.actor ?? "office_today")|trim)
    }
  
    var $new_val_text {
      value = ($input.enabled == true) ? "true" : "false"
    }
  
    var $emoji {
      value = ($input.enabled == true) ? "🟢" : "🔒"
    }
  
    var $state_text {
      value = ($input.enabled == true) ? "ON for parallel jobs" : "OFF"
    }
  
    // Upsert the setting
    db.query company_settings {
      where = $db.company_settings.company_id == 1 && $db.company_settings.setting_key == "customer_facing_enabled"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $existing_rows
  
    var $existing {
      value = (($existing_rows.items|first) ?? null)
    }
  
    conditional {
      if ($existing == null) {
        db.add company_settings {
          data = {
            company_id   : 1
            setting_key  : "customer_facing_enabled"
            setting_value: $new_val_text
          }
        } as $new_row
      }
    
      else {
        db.edit company_settings {
          field_name = "id"
          field_value = $existing.id
          data = {setting_value: $new_val_text}
        } as $updated
      }
    }
  
    // Audit row
    db.add event_log {
      data = {
        action  : "customer_sms_gate_toggled"
        metadata: {
        new_state    : $new_val_text
        enabled      : $input.enabled
        actor        : $actor_clean
        toggled_at_ms: now|to_ms
      }
      }
    } as $audit
  
    // Alert Teddy unconditionally — every flip is high-signal
    var $alert_body {
      value = ("[ant] customer SMS gate flipped " ~ $emoji ~ " " ~ $state_text ~ " (by " ~ $actor_clean ~ ")")
    }
  
    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {
        to         : "+16154855795"
        message    : $alert_body
        context_tag: "gate_toggle_alert"
      }
    
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $owner_alert
  }

  response = {
    success             : true
    customer_sms_enabled: $input.enabled
    state_text          : $state_text
  }

  guid = "toggle-customer-sms-gate-v1"
}