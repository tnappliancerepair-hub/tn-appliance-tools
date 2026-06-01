// Returns pricing modifiers (surge / discount) for a given job context.
// Used by office at booking time + by quote.html to surface the final
// estimate band.
query get_pricing_modifier verb=GET {
  api_group = "intake"

  input {
    text? scheduled_start?
    int? customer_id?
    bool? is_emergency?
  }

  stack {
    var $sched_in {
      value = ($input.scheduled_start ?? "")|trim
    }
  
    var $now_ms {
      value = now|to_ms
    }
  
    var $surge_pct {
      value = 0
    }
  
    var $surge_reason {
      value = ""
    }
  
    // Same-day surge: if scheduled_start is today (within 24h from now)
    conditional {
      if ($sched_in != "") {
        var $sched_ts {
          value = $sched_in|to_timestamp
        }
      
        var $sched_ms {
          value = $sched_ts|to_ms
        }
      
        var $diff_hours {
          value = ($sched_ms - $now_ms) / (60 * 60 * 1000)
        }
      
        conditional {
          if ($diff_hours <= 24 && $diff_hours >= 0) {
            var.update $surge_pct {
              value = 25
            }
          
            var.update $surge_reason {
              value = "same_day"
            }
          }
        
          elseif ($diff_hours <= 48 && $diff_hours >= 0) {
            var.update $surge_pct {
              value = 10
            }
          
            var.update $surge_reason {
              value = "next_day"
            }
          }
        }
      }
    }
  
    // Emergency override stacks on top of surge
    conditional {
      if (($input.is_emergency ? false)) {
        var.update $surge_pct {
          value = $surge_pct + 25
        }
      
        var.update $surge_reason {
          value = $surge_reason ~ "+emergency"
        }
      }
    }
  
    // Customer discount (pull from existing endpoint logic inline)
    var $discount_pct {
      value = 0
    }
  
    conditional {
      if (($input.customer_id ? 0) > 0) {
        db.query jobs {
          where = $db.jobs.customer_id == $input.customer_id && $db.jobs.scheduling_status == "completed"
          return = {type: "count"}
        } as $cust_completed
      
        conditional {
          if (($cust_completed ? 0) >= 5) {
            var.update $discount_pct {
              value = 5
            }
          }
        }
      }
    }
  
    var $net_modifier_pct {
      value = $surge_pct - $discount_pct
    }
  }

  response = {
    success         : true
    surge_pct       : $surge_pct
    surge_reason    : $surge_reason
    discount_pct    : $discount_pct
    net_modifier_pct: $net_modifier_pct
  }

  guid = "get-pricing-modifier-v1"
}