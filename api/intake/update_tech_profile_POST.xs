// Tech-driven profile update from tech-scheduler.html.
// PIN-gated. Only the fields the tech sends get updated; missing fields
// keep their existing value.
query update_tech_profile verb=POST {
  api_group = "intake"

  input {
    int tech_id
    text pin
    text? home_zone?
    text? geographic_strategy?
    int? max_drive_distance?
    int? max_stops_per_day?
    text? appliance_specialties?
    text? brand_exclusions?
    bool? works_saturdays?
    text? preferred_hours_start?
    text? preferred_hours_end?
    text? personal_context?
  }

  stack {
    db.get technicians {
      field_name = "id"
      field_value = $input.tech_id
    } as $tech

    conditional {
      if ($tech == null) {
        return {
          value = {
            success: false
            error  : "tech_not_found"
          }
        }
      }
    }

    var $stored_pin {
      value = (($tech.pin ?? "")|to_text)
    }

    var $supplied_pin {
      value = (($input.pin ?? "")|to_text)
    }

    var $auth_ok {
      value = ($stored_pin != "" && $stored_pin == $supplied_pin)
    }

    conditional {
      if (! $auth_ok) {
        return {
          value = {
            success: false
            error  : "unauthorized"
          }
        }
      }
    }

    db.edit technicians {
      field_name = "id"
      field_value = $input.tech_id
      data = {
        home_zone            : ($input.home_zone ?? $tech.home_zone)
        geographic_strategy  : ($input.geographic_strategy ?? $tech.geographic_strategy)
        max_drive_distance   : ($input.max_drive_distance ?? $tech.max_drive_distance)
        max_stops_per_day    : ($input.max_stops_per_day ?? $tech.max_stops_per_day)
        appliance_specialties: ($input.appliance_specialties ?? $tech.appliance_specialties)
        brand_exclusions     : ($input.brand_exclusions ?? $tech.brand_exclusions)
        works_saturdays      : ($input.works_saturdays ?? $tech.works_saturdays)
        preferred_hours_start: ($input.preferred_hours_start ?? $tech.preferred_hours_start)
        preferred_hours_end  : ($input.preferred_hours_end ?? $tech.preferred_hours_end)
        personal_context     : ($input.personal_context ?? $tech.personal_context)
      }
    } as $updated_tech

    db.add event_log {
      data = {
        action  : "tech_profile_updated"
        metadata: ```
          {
            tech_id: $input.tech_id
            source : "tech_scheduler_page"
          }|json_encode
        ```
      }
    }
  }

  response = {
    success: true
    tech   : $updated_tech
  }

  guid = "update-tech-profile-v1"
}
