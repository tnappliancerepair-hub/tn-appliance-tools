// Real-time SMS activity pulse for the customer-facing gate flip.
// Returns counts of sent / dropped / inbound / errors over the last
// N minutes (default 60), plus the 20 most recent send attempts.
// Used by /sms-pulse.html to watch for spam / silent-failure / weird
// content immediately after the SMS gate toggles on.
query get_sms_pulse verb=GET {
  api_group = "intake"

  input {
    int? minutes_back?
  }

  stack {
    var $mins { value = ($input.minutes_back ?? 60) }
    var $cutoff_ms { value = ((now|to_ms) - ($mins * 60 * 1000)) }
    var $cutoff_ts { value = ($cutoff_ms / 1000)|to_timestamp }

    // Counts by action type
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && ($db.event_log.action == "sms_sent" || $db.event_log.action == "dropped_customer_sms" || $db.event_log.action == "sms_provider_error" || $db.event_log.action == "sms_owner_bypass" || $db.event_log.action == "sms_gated")
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $sms_rows

    var $count_sent { value = 0 }
    var $count_dropped { value = 0 }
    var $count_errors { value = 0 }
    var $count_gated { value = 0 }
    var $count_owner_bypass { value = 0 }
    var $recent_sample { value = [] }
    var $sample_cap { value = 20 }

    foreach ($sms_rows.items) {
      each as $r {
        var $a { value = ($r.action ?? "") }
        conditional {
          if ($a == "sms_sent") { var.update $count_sent { value = ($count_sent + 1) } }
        }
        conditional {
          if ($a == "dropped_customer_sms") { var.update $count_dropped { value = ($count_dropped + 1) } }
        }
        conditional {
          if ($a == "sms_provider_error") { var.update $count_errors { value = ($count_errors + 1) } }
        }
        conditional {
          if ($a == "sms_gated") { var.update $count_gated { value = ($count_gated + 1) } }
        }
        conditional {
          if ($a == "sms_owner_bypass") { var.update $count_owner_bypass { value = ($count_owner_bypass + 1) } }
        }

        var $sample_len { value = ($recent_sample|count) }
        conditional {
          if ($sample_len < $sample_cap) {
            var $sample_row {
              value = {
                id        : $r.id
                action    : $a
                created_at: $r.created_at
                metadata  : $r.metadata
              }
            }
            var.update $recent_sample {
              value = $recent_sample|push:$sample_row
            }
          }
        }
      }
    }

    // Inbound customer SMS in same window
    db.query event_log {
      where = $db.event_log.created_at >= $cutoff_ts && $db.event_log.action == "inbound_customer_sms_received"
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $inbound_rows

    var $count_inbound { value = ($inbound_rows.items|count) }

    // Read the gate state (from company_settings, falls back to env)
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

    var $gate_on {
      value = ($gate_setting_val != "") ? ($gate_setting_val == "true") : $env_gate
    }
  }

  response = {
    success         : true
    minutes_back    : $mins
    gate_on         : $gate_on
    counts          : {
      sent          : $count_sent
      dropped       : $count_dropped
      errors        : $count_errors
      gated         : $count_gated
      owner_bypass  : $count_owner_bypass
      inbound       : $count_inbound
    }
    recent_sample   : $recent_sample
  }

  guid = "get-sms-pulse-v1"
}
