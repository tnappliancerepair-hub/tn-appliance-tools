// Determines the highest priority job for a customer and returns a status summary.
query job_priority_summary verb=GET {
  api_group = "intake"

  input {
    // The ID of the customer to check jobs for.
    int customer_id
  }

  stack {
    // Initialize variables with default values
    var $highest_priority_job {
      value = null
    }
  
    var $status_summary {
      value = "No active jobs."
    }
  
    var $next_step {
      value = "N/A"
    }
  
    var $priority {
      value = 0
    }
  
    // Map job statuses to numerical priority values
    var $priority_levels {
      value = {
        emergency        : 5
        in_progress      : 4
        waiting_for_parts: 3
        pending          : 2
        completed        : 1
      }
    }
  
    // Fetch all jobs for the customer
    db.query jobs {
      where = $db.jobs.customer_id == $input.customer_id
      return = {type: "list"}
    } as $jobs
  
    // Iterate through jobs to find the highest priority job
    foreach ($jobs) {
      each as $job {
        var $current_priority {
          value = $priority_levels
            |get:$job.current_status
            |first_notnull:0
        }
      
        conditional {
          if ($current_priority > $priority) {
            var.update $priority {
              value = $current_priority
            }
          
            var.update $highest_priority_job {
              value = $job
            }
          }
        }
      }
    }
  
    // Apply detailed status rules only to the highest priority job
    conditional {
      if ($highest_priority_job != null) {
        conditional {
          if ($highest_priority_job.current_status == "emergency") {
            var.update $status_summary {
              value = "Emergency service requested."
            }
          
            var.update $next_step {
              value = "A technician is being dispatched immediately."
            }
          }
        
          elseif ($highest_priority_job.current_status == "in_progress") {
            var.update $status_summary {
              value = "Service is currently in progress."
            }
          
            var.update $next_step {
              value = "Awaiting technician completion."
            }
          }
        
          elseif ($highest_priority_job.current_status == "waiting_for_parts") {
            var.update $status_summary {
              value = "Waiting for parts to arrive."
            }
          
            var.update $next_step {
              value = "Service will resume once parts are received."
            }
          }
        
          elseif ($highest_priority_job.current_status == "pending") {
            var.update $status_summary {
              value = "Job is pending review."
            }
          
            var.update $next_step {
              value = "We will schedule your service shortly."
            }
          }
        
          elseif ($highest_priority_job.current_status == "completed") {
            var.update $status_summary {
              value = "Service completed."
            }
          
            var.update $next_step {
              value = "No further action required."
            }
          }
        
          else {
            var.update $status_summary {
              value = "Status: " ~ $highest_priority_job.current_status
            }
          
            var.update $next_step {
              value = "Please contact support for more details."
            }
          }
        }
      }
    }
  }

  response = {
    job_count     : $jobs|count
    status_summary: $status_summary
    next_step     : $next_step
    priority      : $priority
  }

  guid = "TjuPhGaQB-XpyEDAZxjtWRamSrE"
}