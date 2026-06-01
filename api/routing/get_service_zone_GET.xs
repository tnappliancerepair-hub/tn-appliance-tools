// Check if a zip code is within a service zone
query get_service_zone verb=GET {
  api_group = "routing"

  input {
    // The zip code to check
    text zip_code filters=trim
  }

  stack {
    // Search the service_zone table for the provided zip code
    db.query service_zone {
      where = $db.service_zone.zip_code == $input.zip_code
      return = {type: "single"}
    } as $service_zone_record
  
    // Check if a service zone record was found
    conditional {
      if ($service_zone_record == null) {
        var $result {
          value = {found: false, zone: null}
        }
      }
    
      else {
        var $result {
          value = {found: true, zone: $service_zone_record}
        }
      }
    }
  }

  response = $result
  guid = "JKsoiEuZUmKNtNHatVL-C0pZUfM"
}