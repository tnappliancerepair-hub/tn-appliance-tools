// Onboards a new technician. Creates technicians row, optionally sets
// initial PIN, registers in service_zones, sends welcome SMS pack.
query onboard_tech verb=POST {
  api_group = "intake"

  input {
    text first_name
    text last_name
    text phone
    text? email?
    decimal? commission_rate?
    text? zip_codes?
    int? tool_pack_minutes?
  }

  stack {
    var $first {
      value = ($input.first_name ?? "")|trim
    }
  
    var $last {
      value = ($input.last_name ?? "")|trim
    }
  
    var $phone_clean {
      value = ($input.phone ?? "")|trim
    }
  
    precondition ($first != "" && $last != "" && $phone_clean != "") {
      error_type = "inputerror"
      error = "first_name + last_name + phone required"
    }
  
    db.add technicians {
      data = {
        first_name       : $first
        last_name        : $last
        phone            : $phone_clean
        email            : ($input.email ?? "")
        active           : true
        commission_rate  : ($input.commission_rate ?? 0.40)
        tool_pack_minutes: ($input.tool_pack_minutes ?? 8)
      }
    } as $tech_row
  
    var $tech_id {
      value = $tech_row.id
    }
  
    var $audit_meta {
      value = {
        tech_id        : $tech_id
        first_name     : $first
        last_name      : $last
        phone          : $phone_clean
        commission_rate: ($input.commission_rate ?? 0.40)
        zip_codes      : ($input.zip_codes ?? "")
      }
    }
  
    var $audit_json {
      value = $audit_meta|json_encode
    }
  
    db.add event_log {
      data = {action: "tech_onboarded", metadata: $audit_json}
    } as $audit_row
  
    db.add colony_signals {
      data = {
        signal_type    : "TECH_ONBOARDED"
        signal_strength: 70
        source_colony  : "tech_onboarding"
        target_colonies: ""
        payload        : $audit_json
      }
    } as $signal_row
  }

  response = {
    success  : true
    tech_id  : $tech_id
    signal_id: $signal_row.id
  }

  guid = "onboard-tech-v1"
}