query get_slot_options verb=GET {
  api_group = "routing"

  input {
    text zip_code filters=trim
  }

  stack {
    db.query service_zone {
      where = $db.service_zone.zip_code == $input.zip_code && $db.service_zone.active == true
      return = {type: "single"}
    } as $service_zone_record
  
    var $result {
      value = {}
    }
  
    conditional {
      if ($service_zone_record == null) {
        var.update $result {
          value = {
            found            : false
            decision         : "OUT_OF_SERVICE_AREA"
            action           : "manual_review"
            slots_available  : false
            available_windows: []
            reason           : "ZIP not found"
            zone             : null
          }
        }
      }
    
      elseif ($service_zone_record.accept_new_jobs == false) {
        var.update $result {
          value = {
            found            : true
            decision         : "REJECTED_ZONE"
            action           : "manual_review"
            slots_available  : false
            available_windows: []
            reason           : "Zone not accepting jobs"
            zone             : $service_zone_record
          }
        }
      }
    
      elseif ($service_zone_record.requires_manual_review) {
        var.update $result {
          value = {
            found            : true
            decision         : "MANUAL_REVIEW_REQUIRED"
            action           : "manual_review"
            slots_available  : false
            available_windows: []
            reason           : "Zone requires manual review"
            zone             : $service_zone_record
          }
        }
      }
    
      else {
        var.update $result {
          value = {
            found            : true
            decision         : "ALLOW_BOOKING"
            action           : "auto_schedule"
            slots_available  : true
            available_windows: $service_zone_record.allowed_time_windows
            blocked_windows  : $service_zone_record.blocked_time_windows
            reason           : "Zone eligible for scheduling"
            zone             : $service_zone_record
          }
        }
      }
    }
  }

  response = $result
  guid = "A9_yTLhze-0LcJrIMFDdCe1_nUc"
}