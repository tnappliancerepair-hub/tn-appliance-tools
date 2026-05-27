// Tech-driven day-off toggle. Writes a tech_availability row marking
// the requested date as a full-day-off OR removes existing rows (toggle off).
//
// Inputs:
//   technician_id : tech id
//   date          : ISO date string (YYYY-MM-DD), CT-local interpretation
//   off           : bool — true to set day off, false to clear
//   reason        : optional text
query tech_set_day_off verb=POST {
  api_group = "intake"

  input {
    int technician_id
    text date
    bool off
    text? reason?
  }

  stack {
    var $date_clean {
      value = ($input.date ?? "")|trim
    }

    precondition ($date_clean != "") {
      error_type = "inputerror"
      error      = "date is required"
    }

    // Look for existing row for this tech+date
    db.query tech_availability {
      where  = $db.tech_availability.technician_id == $input.technician_id && $db.tech_availability.blocked_date == $date_clean
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $existing_rows

    var $action_taken { value = "" }

    conditional {
      if ($input.off == true) {
        var $first_existing {
          value = (($existing_rows.items|first) ?? null)
        }

        conditional {
          if ($first_existing == null) {
            db.add tech_availability {
              data = {
                technician_id  : $input.technician_id
                blocked_date   : $date_clean
                full_day_off   : true
                reason         : ($input.reason ?? "")
              }
            } as $created

            var.update $action_taken { value = "created" }
          }

          else {
            db.edit tech_availability {
              field_name  = "id"
              field_value = $first_existing.id
              data        = {
                full_day_off : true
                reason       : ($input.reason ?? "")
              }
            } as $updated

            var.update $action_taken { value = "updated" }
          }
        }
      }

      else {
        // Toggle off — delete all existing rows for this tech+date
        var $deleted_count { value = 0 }

        foreach ($existing_rows.items) {
          each as $row {
            db.del tech_availability {
              field_name  = "id"
              field_value = $row.id
            }

            var.update $deleted_count {
              value = $deleted_count + 1
            }
          }
        }

        var.update $action_taken { value = "deleted_" ~ ($deleted_count|to_text) }
      }
    }

    // Audit
    db.add event_log {
      data = {
        action   : "tech_day_off_set"
        metadata : {
          technician_id : $input.technician_id
          date          : $date_clean
          off           : $input.off
          reason        : ($input.reason ?? "")
          action_taken  : $action_taken
        }|json_encode
      }
    } as $audit_row
  }

  response = {
    success      : true
    technician_id: $input.technician_id
    date         : $date_clean
    off          : $input.off
    action_taken : $action_taken
  }

  guid = "tech-set-day-off-v1"
}
