// Return the summary of the bootstrapping process
// One-time admin endpoint to bootstrap default availability for all active technicians.
query bootstrap_tech_schedule verb=POST {
  api_group = "scheduling"

  input {
    // The number of days into the future to examine (default: 90)
    int days_ahead?=90
  }

  stack {
    // Initialize counters for the summary report
    var $techs_processed {
      value = 0
    }
  
    var $days_examined {
      value = 0
    }
  
    var $rows_created {
      value = 0
    }
  
    var $rows_skipped {
      value = 0
    }
  
    // Fetch all active technicians from the database
    db.query technicians {
      where = $db.technicians.active == true
      return = {type: "list"}
    } as $active_techs
  
    // Pre-calculate valid weekdays (Monday-Friday) for the given timeframe
    var $valid_dates {
      value = []
    }
  
    var $cursor {
      value = now
    }
  
    for ($input.days_ahead) {
      each as $i {
        // Move to the next day
        var.update $cursor {
          value = $cursor|transform_timestamp:"+1 day"
        }
      
        // Check the day name (e.g., Monday, Saturday)
        var $day_name {
          value = $cursor|format_timestamp:"l"
        }
      
        // Skip weekends and only collect weekdays
        conditional {
          if ($day_name != "Saturday" && $day_name != "Sunday") {
            var.update $valid_dates {
              value = $valid_dates
                |push:($cursor|format_timestamp:"Y-m-d")
            }
          }
        }
      }
    }
  
    // Record how many days we checked in total
    var.update $days_examined {
      value = $input.days_ahead
    }
  
    // Process each technician to ensure they have availability records
    foreach ($active_techs) {
      each as $tech {
        var.update $techs_processed {
          value = $techs_processed + 1
        }
      
        // For each pre-calculated weekday, ensure a row exists in tech_availability
        foreach ($valid_dates) {
          each as $date {
            // Check if availability already exists for this tech and date
            db.query tech_availability {
              where = $db.tech_availability.technician_id == $tech.id && $db.tech_availability.blocked_date == $date
              return = {type: "exists"}
            } as $exists
          
            conditional {
              if ($exists) {
                // Row exists, so we skip it to maintain idempotency
                var.update $rows_skipped {
                  value = $rows_skipped + 1
                }
              }
            
              else {
                // Row is missing, so we create a default 8-4 shift
                db.add tech_availability {
                  data = {
                    technician_id: $tech.id
                    blocked_date : $date
                    start_time   : "08:00"
                    end_time     : "16:00"
                    full_day_off : false
                    reason       : "default_schedule"
                  }
                } as $new_availability
              
                var.update $rows_created {
                  value = $rows_created + 1
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    techs_processed: $techs_processed
    days_examined  : $days_examined
    rows_created   : $rows_created
    rows_skipped   : $rows_skipped
    success        : true
  }

  guid = "RX5_WrsRfWTB137WJdO7sTcqK3s"
}