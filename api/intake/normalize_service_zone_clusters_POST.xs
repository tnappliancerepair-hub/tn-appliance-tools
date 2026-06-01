query normalize_service_zone_clusters verb=POST {
  api_group = "intake"

  input {
  }

  stack {
    // Initialize counters and tracking arrays
    var $clusters_renamed {
      value = 0
    }
  
    var $omer_default_replacements {
      value = 0
    }
  
    var $omer_allowed_cleanups {
      value = 0
    }
  
    var $unknown_clusters_found {
      value = []
    }
  
    // Exact legacy cluster mappings
    var $cluster_mappings {
      value = {
        "Northwest TN": "TN Northwest",
        "Metro West": "TN Metro",
        "South Nashville": "TN Metro",
        "SE Nashville": "TN East",
        "NE Nashville": "TN East",
        "East Nashville": "TN East",
        "Northshore": "LA North",
        "Baton Rouge": "LA West",
        "NOLA": "LA South"
      }
    }
  
    // Exact standardized cluster names
    var $standard_clusters {
      value = [
        "TN Northwest"
        "TN Metro"
        "TN East"
        "LA North"
        "LA West"
        "LA South"
      ]
    }
  
    // Safety Check: Query service_zone table to count rows that are already standardized
    db.query service_zone {
      where = $db.service_zone.cluster == "TN Northwest" || $db.service_zone.cluster == "TN Metro" || $db.service_zone.cluster == "TN East" || $db.service_zone.cluster == "LA North" || $db.service_zone.cluster == "LA West" || $db.service_zone.cluster == "LA South"
      return = {type: "count"}
    } as $standard_count
  
    // If count is > 95, return early to prevent re-running
    conditional {
      if ($standard_count > 95) {
        return {
          value = {
            success: false
            message: "Already normalized, aborting"
          }
        }
      }
    }
  
    // Retrieve all records from the service_zone table
    db.query service_zone {
      return = {type: "list"}
    } as $all_zones
  
    // Loop through each service_zone record to apply normalization and cleanup logic
    foreach ($all_zones) {
      each as $zone {
        var $has_changes {
          value = false
        }
      
        var $new_cluster {
          value = $zone.cluster
        }
      
        var $new_default_tech {
          value = $zone.default_technician
        }
      
        var $new_allowed_techs {
          value = $zone.allowed_technicians
        }
      
        // Check and update the cluster field using EXACT string matching
        conditional {
          if ($zone.cluster != null) {
            conditional {
              if ($cluster_mappings|has:$zone.cluster) {
                var.update $new_cluster {
                  value = $cluster_mappings|get:$zone.cluster
                }
              
                var.update $has_changes {
                  value = true
                }
              
                var.update $clusters_renamed {
                  value = $clusters_renamed + 1
                }
              }
            
              elseif ($standard_clusters|contains:$zone.cluster|not) {
                // Track unknown clusters distinctly
                conditional {
                  if ($unknown_clusters_found|contains:$zone.cluster|not) {
                    array.push $unknown_clusters_found {
                      value = $zone.cluster
                    }
                  }
                }
              }
            }
          }
        }
      
        // Check and update the default_technician field
        conditional {
          if ($zone.default_technician == "Omer") {
            var.update $new_default_tech {
              value = "Billy"
            }
          
            var.update $has_changes {
              value = true
            }
          
            var.update $omer_default_replacements {
              value = $omer_default_replacements + 1
            }
          }
        }
      
        // Check and update the allowed_technicians field by splitting, filtering, and joining
        conditional {
          if ($zone.allowed_technicians != null && ($zone.allowed_technicians|contains:"Omer")) {
            var $tech_array {
              value = $zone.allowed_technicians|split:"|"
            }
          
            var $filtered_techs {
              value = $tech_array|filter:$this != "Omer"
            }
          
            var.update $new_allowed_techs {
              value = $filtered_techs|join:"|"
            }
          
            var.update $has_changes {
              value = true
            }
          
            var.update $omer_allowed_cleanups {
              value = $omer_allowed_cleanups + 1
            }
          }
        }
      
        // Perform a single db.edit call per row ONLY if changes were made
        conditional {
          if ($has_changes) {
            db.edit service_zone {
              field_name = "id"
              field_value = $zone.id
              data = {
                cluster            : $new_cluster
                default_technician : $new_default_tech
                allowed_technicians: $new_allowed_techs
              }
            } as $updated_zone
          }
        }
      }
    }
  }

  response = {
    success                  : true
    clusters_renamed         : $clusters_renamed
    omer_default_replacements: $omer_default_replacements
    omer_allowed_cleanups    : $omer_allowed_cleanups
    unknown_clusters_found   : $unknown_clusters_found
    message                  : "Normalization complete"
  }

  guid = "Wixex85bnA5uOxJ3Ynnxxut_WmQ"
}