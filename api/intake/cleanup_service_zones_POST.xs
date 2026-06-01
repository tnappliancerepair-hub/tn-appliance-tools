// Cleans up duplicate service zones and fixes technician IDs
query cleanup_service_zones verb=POST {
  api_group = "intake"

  input {
  }

  stack {
    // Initialize tracking variables
    var $duplicates_deleted {
      value = 0
    }
  
    var $deleted_ids {
      value = []
    }
  
    var $tech_ids_fixed {
      value = 0
    }
  
    // Count all rows in service_zone
    db.query service_zone {
      return = {type: "count"}
    } as $zone_count
  
    // Abort if less than 50 zones found
    conditional {
      if ($zone_count < 50) {
        return {
          value = {
            success: false
            message: "Less than 50 zones found, aborting cleanup to prevent accidental data loss."
          }
        }
      }
    }
  
    // Retrieve all records from service_zone
    db.query service_zone {
      return = {type: "list"}
    } as $all_zones
  
    // Group service zones by zip_code
    array.group_by ($all_zones) {
      by = $this.zip_code
    } as $zones_by_zip
  
    // Extract the grouped arrays
    object.values {
      value = $zones_by_zip
    } as $zone_groups
  
    // Iterate through each group to find and delete duplicates
    foreach ($zone_groups) {
      each as $group {
        conditional {
          if (($group|count) > 1) {
            // Sort by ID descending to keep the highest ID
            var $sorted_group {
              value = $group|sort:"id":"number":true
            }
          
            // Remove the first element (highest ID) to keep it
            array.shift $sorted_group as $kept_zone
          
            // Delete the remaining duplicate entries
            foreach ($sorted_group) {
              each as $zone_to_delete {
                db.del service_zone {
                  field_name = "id"
                  field_value = $zone_to_delete.id
                }
              
                var.update $duplicates_deleted {
                  value = $duplicates_deleted + 1
                }
              
                array.push $deleted_ids {
                  value = $zone_to_delete.id
                }
              }
            }
          }
        }
      }
    }
  
    // Fetch all remaining records after deletion
    db.query service_zone {
      return = {type: "list"}
    } as $remaining_zones
  
    // Iterate through remaining zones to fix technician IDs
    foreach ($remaining_zones) {
      each as $zone {
        conditional {
          if ($zone.default_technician != null && $zone.default_technician != "") {
            // Find the technician by first_name
            db.query technicians {
              where = $db.technicians.first_name == $zone.default_technician
              return = {type: "single"}
            } as $tech
          
            // If technician is found and ID doesn't match, update the service zone
            conditional {
              if ($tech != null && $tech.id != $zone.technician_id) {
                db.edit service_zone {
                  field_name = "id"
                  field_value = $zone.id
                  data = {technician_id: $tech.id}
                } as $updated_zone
              
                var.update $tech_ids_fixed {
                  value = $tech_ids_fixed + 1
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    success           : true
    duplicates_deleted: $duplicates_deleted
    deleted_ids       : $deleted_ids
    tech_ids_fixed    : $tech_ids_fixed
    message           : "Service zone cleanup completed successfully."
  }

  guid = "4KJEIuJYttjAg_0PD-RqKKkV4qc"
}