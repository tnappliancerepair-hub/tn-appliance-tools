// Checks the service zone rules for a given zip code.
query check_service_zone verb=GET {
  api_group = "routing"

  input {
    // Zip code to check for service availability
    text zip_code filters=trim
  }

  stack {
    // Query the service_zone table for the provided zip code where active is true
    db.query service_zone {
      where = $db.service_zone.zip_code == $input.zip_code && $db.service_zone.active == true
      return = {type: "single"}
    } as $service_zone_record
  
    // Check if the service zone exists and apply business rules
    conditional {
      if ($service_zone_record == null) {
        return {
          value = {
            found   : false
            decision: "OUT_OF_SERVICE_AREA"
            action  : "reject"
            zone    : null
          }
        }
      }
    }
  
    conditional {
      if ($service_zone_record.accept_new_jobs == false) {
        return {
          value = {
            found   : true
            decision: "REJECTED_ZONE"
            action  : "manual_review"
            zone    : $service_zone_record
          }
        }
      }
    
      elseif ($service_zone_record.requires_manual_review) {
        return {
          value = {
            found   : true
            decision: "MANUAL_REVIEW_REQUIRED"
            action  : "manual_review"
            zone    : $service_zone_record
          }
        }
      }
    
      else {
        return {
          value = {
            found   : true
            decision: "ALLOW_BOOKING"
            action  : "auto_schedule"
            zone    : $service_zone_record
          }
        }
      }
    }
  }

  response = null
  guid = "GkhGXlD7IIBngzqrbnullxa8gck"
}