query get_available_slots verb=GET {
  api_group = "intake"

  input {
    text zip_code filters=trim
    int days_ahead?=5
  }

  stack {
    // Look up the service zone based on the zip code provided
    db.query service_zone {
      where = $db.service_zone.zip_code == $input.zip_code
      sort = {id: "desc"}
      return = {type: "single"}
    } as $zone
  
    // Precondition: Trigger out_of_area error if no zone is found
    precondition ($zone != null) {
      error_type = "notfound"
      error = "out_of_area"
    }
  
    // Fetch cluster assignments for the zone's cluster
    db.query cluster_assignment {
      where = $db.cluster_assignment.cluster == $zone.cluster && $db.cluster_assignment.active == true
      sort = {cluster_assignment.rank: "asc"}
      return = {type: "list"}
    } as $cluster_assignments
  
    // Identify all active technicians assigned to the cluster
    var $active_techs {
      value = []
    }
  
    foreach ($cluster_assignments) {
      each as $assignment {
        db.query technicians {
          where = $db.technicians.id == $assignment.technician_id && $db.technicians.active == true
          return = {type: "single"}
        } as $t
      
        conditional {
          if ($t != null) {
            var.update $active_techs {
              value = $active_techs|push:$t
            }
          }
        }
      }
    }
  
    // Precondition: Trigger if zero techs are assigned to the cluster
    precondition (($active_techs|count) > 0) {
      error_type = "notfound"
      error = "No active technician assigned to this zone"
    }
  
    var $days {
      value = $input.days_ahead ?? 5
    }
  
    var $slots {
      value = []
    }
  
    // Parse time windows from the service zone
    var $raw_windows {
      value = ($zone.allowed_time_windows ?? "")|split:"|"
    }
  
    var $clean_windows {
      value = []
    }
  
    foreach ($raw_windows) {
      each as $item {
        var $trimmed {
          value = $item|trim
        }
      
        conditional {
          if (($trimmed|strlen) > 0) {
            var.update $clean_windows {
              value = $clean_windows|push:$trimmed
            }
          }
        }
      }
    }
  
    // Replace the default windows fallback
    conditional {
      if (($clean_windows|count) == 0) {
        var.update $clean_windows {
          value = ["8-11", "11-2", "2-5"]
        }
      }
    }
  
    // Loop every active tech in the cluster
    foreach ($active_techs) {
      each as $tech {
        // Fetch existing bookings for this specific tech
        db.query jobs {
          where = $db.jobs.technician_id == $tech.id && $db.jobs.scheduled_start != null
          return = {type: "list"}
        } as $booked_jobs
      
        // Iterate through each day in the requested range
        for (($days + 1)) {
          each as $offset {
            var $target_ts {
              value = now
                |transform_timestamp:"+" ~ ($offset|to_text) ~ " days"
            }
          
            var $target_date {
              value = $target_ts|format_timestamp:"Y-m-d"
            }
          
            var $day_name {
              value = $target_ts|format_timestamp:"l"
            }
          
            // Both Saturday and Sunday are skipped
            conditional {
              if (($day_name != "Sunday") && ($day_name != "Saturday")) {
                // Enforce daily capacity rule based on job_time
                var $weighted_total {
                  value = 0
                }
              
                foreach ($booked_jobs) {
                  each as $job {
                    conditional {
                      if (($job.scheduled_start|format_timestamp:"Y-m-d") == $target_date) {
                        conditional {
                          if ($job.job_time == "long") {
                            var.update $weighted_total {
                              value = $weighted_total + 2
                            }
                          }
                        
                          elseif ($job.job_time == "all_day") {
                            var.update $weighted_total {
                              value = $weighted_total + 7
                            }
                          }
                        
                          else {
                            var.update $weighted_total {
                              value = $weighted_total + 1
                            }
                          }
                        }
                      }
                    }
                  }
                }
              
                // If weighted total is already 7 or more, skip the entire day for this tech
                conditional {
                  if ($weighted_total < 7) {
                    // Look up the schedule record for this tech/date
                    db.query tech_availability {
                      where = $db.tech_availability.technician_id == $tech.id && $db.tech_availability.blocked_date == $target_date
                      return = {type: "single"}
                    } as $schedule_row
                  
                    conditional {
                      if (($schedule_row != null) && (!$schedule_row.full_day_off)) {
                        // Parse tech working hours (format "08:00")
                        var $tech_start_hour {
                          value = ($schedule_row.start_time|substr:0:2)|to_int
                        }
                      
                        var $tech_end_hour {
                          value = ($schedule_row.end_time|substr:0:2)|to_int
                        }
                      
                        // Check each time window for availability
                        foreach ($clean_windows) {
                          each as $window {
                            var $win_parts {
                              value = $window|split:"-"
                            }
                          
                            var $win_start {
                              value = $win_parts|first|trim
                            }
                          
                            var $win_end {
                              value = $win_parts|last|trim
                            }
                          
                            // Parse window hours from "8-11" format
                            var $window_start_hour {
                              value = $win_start|to_int
                            }
                          
                            conditional {
                              if ($window_start_hour < 8) {
                                var.update $window_start_hour {
                                  value = $window_start_hour + 12
                                }
                              }
                            }
                          
                            var $window_end_hour {
                              value = $win_end|to_int
                            }
                          
                            conditional {
                              if ($window_end_hour < 8) {
                                var.update $window_end_hour {
                                  value = $window_end_hour + 12
                                }
                              }
                            }
                          
                            // Check if window fits in tech schedule
                            var $fits_hours {
                              value = ($window_start_hour >= $tech_start_hour) && ($window_end_hour <= $tech_end_hour)
                            }
                          
                            conditional {
                              if ($fits_hours) {
                                // Check if window is already booked
                                var $is_booked {
                                  value = false
                                }
                              
                                foreach ($booked_jobs) {
                                  each as $booked_job {
                                    conditional {
                                      if (($is_booked == false) && (($booked_job.scheduled_start|format_timestamp:"Y-m-d") == $target_date) && (($booked_job.service_eta_window|trim) == $window)) {
                                        var.update $is_booked {
                                          value = true
                                        }
                                      }
                                    }
                                  }
                                }
                              
                                // Ensure the window is not in the past for today's slots
                                var $is_past {
                                  value = false
                                }
                              
                                conditional {
                                  if ($offset == 0) {
                                    var $now_hour {
                                      value = now|format_timestamp:"H"|to_int
                                    }
                                  
                                    conditional {
                                      if ($now_hour >= $window_start_hour) {
                                        var.update $is_past {
                                          value = true
                                        }
                                      }
                                    }
                                  }
                                }
                              
                                // If window is open, format and add to slots
                                conditional {
                                  if (!$is_booked && !$is_past) {
                                    // Use raw integer values for display formatting logic
                                    var $h1 {
                                      value = $win_start|to_int
                                    }
                                  
                                    var $h2 {
                                      value = $win_end|to_int
                                    }
                                  
                                    var $t1 {
                                      value = ""
                                    }
                                  
                                    var $t2 {
                                      value = ""
                                    }
                                  
                                    // Format start hour string
                                    conditional {
                                      if (($win_start|to_lower|contains:"am") || ($win_start|to_lower|contains:"pm")) {
                                        var.update $t1 {
                                          value = $win_start|to_lower
                                        }
                                      }
                                    
                                      elseif (($h1 > 0) || ($win_start == "0")) {
                                        conditional {
                                          if (($h1 >= 8) && ($h1 < 12)) {
                                            var.update $t1 {
                                              value = ($h1|to_text) ~ "am"
                                            }
                                          }
                                        
                                          elseif ($h1 == 12) {
                                            var.update $t1 {
                                              value = "12pm"
                                            }
                                          }
                                        
                                          else {
                                            var $display_h {
                                              value = $h1
                                            }
                                          
                                            conditional {
                                              if ($h1 > 12) {
                                                var.update $display_h {
                                                  value = $h1 - 12
                                                }
                                              }
                                            }
                                          
                                            var.update $t1 {
                                              value = ($display_h|to_text) ~ "pm"
                                            }
                                          }
                                        }
                                      }
                                    }
                                  
                                    // Format end hour string
                                    conditional {
                                      if (($win_end|to_lower|contains:"am") || ($win_end|to_lower|contains:"pm")) {
                                        var.update $t2 {
                                          value = $win_end|to_lower
                                        }
                                      }
                                    
                                      elseif (($h2 > 0) || ($win_end == "0")) {
                                        conditional {
                                          if (($h2 >= 8) && ($h2 < 12)) {
                                            var.update $t2 {
                                              value = ($h2|to_text) ~ "am"
                                            }
                                          }
                                        
                                          elseif ($h2 == 12) {
                                            var.update $t2 {
                                              value = "12pm"
                                            }
                                          }
                                        
                                          else {
                                            var $display_h {
                                              value = $h2
                                            }
                                          
                                            conditional {
                                              if ($h2 > 12) {
                                                var.update $display_h {
                                                  value = $h2 - 12
                                                }
                                              }
                                            }
                                          
                                            var.update $t2 {
                                              value = ($display_h|to_text) ~ "pm"
                                            }
                                          }
                                        }
                                      }
                                    }
                                  
                                    conditional {
                                      if ((($t1|strlen) > 0) && (($t2|strlen) > 0)) {
                                        var $new_slot {
                                          value = {
                                            date           : $target_date
                                            day            : $day_name
                                            window         : ($t1 ~ "-" ~ $t2)
                                            tech_id        : $tech.id
                                            tech_name      : ($tech.first_name ~ " " ~ $tech.last_name)
                                            tech_first_name: $tech.first_name
                                          }
                                        }
                                      
                                        var.update $slots {
                                          value = $slots|push:$new_slot
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  
    var $result {
      value = {available_slots: $slots, cluster: $zone.cluster}
    }
  
    conditional {
      if (($slots|count) == 0) {
        var.update $result {
          value = $result
            |set:"message":"No availability in the next " ~ ($days|to_text) ~ " days"
        }
      }
    }
  }

  response = $result
  guid = "hy1Zl-ztKTZbRo9teCIxkKKEjlg"
}