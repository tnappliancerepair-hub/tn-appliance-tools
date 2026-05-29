// Returns next 5 reasonable slots for a tech over the next 7 days.
// Used by customer_reschedule_offer to compose the 3-slot SMS.
//
// "Reasonable" = a 3-hour arrival window on a day where:
//   - tech is not marked off (tech_availability.full_day_off != true)
//   - tech has < 5 jobs already booked
//   - day is a weekday (TN Appliance closes weekends by default)
//
// Returns slot windows: 8-11am, 11am-2pm, 2-5pm CT — one per day per
// available window. Up to 5 slots total across the 7-day horizon.
query get_tech_slots_for_zip verb=GET {
  api_group = "intake"

  input {
    int technician_id
    int? days_ahead?
    int? max_slots?
  }

  stack {
    precondition ($input.technician_id > 0) {
      error_type = "inputerror"
      error      = "technician_id required"
    }

    var $days  { value = ($input.days_ahead ?? 7) }
    var $max   { value = ($input.max_slots ?? 5) }
    var $now_ms { value = now|to_ms }
    var $day_ms { value = 86400000 }

    var $slots { value = [] }
    var $slot_count { value = 0 }
    var $day_idx { value = 1 }

    foreach ($i in [1, 2, 3, 4, 5, 6, 7]) {
      conditional {
        if ($slot_count < $max) {
          var $day_start_ms { value = ($now_ms + ($day_idx * $day_ms)) }
          var $day_end_ms   { value = ($day_start_ms + $day_ms) }

          // Check weekday (Mon-Fri); format weekday in CT
          var $weekday { value = $day_start_ms|format_datetime:"D":"America/Chicago" }
          var $is_weekend { value = ($weekday == "Sat" || $weekday == "Sun") }

          // Check day-off
          db.query tech_availability {
            filter {
              $this.technician_id == $input.technician_id
              && $this.date_ms >= $day_start_ms
              && $this.date_ms <  $day_end_ms
              && $this.full_day_off == true
            }
            per_page = 1
          } as $off_rows
          var $is_day_off { value = (($off_rows.items|first) != null) }

          // Count existing jobs for tech on this day
          db.query jobs {
            filter {
              $this.technician_id == $input.technician_id
              && $this.scheduled_start >= $day_start_ms
              && $this.scheduled_start <  $day_end_ms
              && $this.scheduling_status == "scheduled"
            }
            per_page = 50
          } as $job_rows
          var $job_count { value = 0 }
          foreach ($j in $job_rows.items) {
            var $job_count { value = ($job_count + 1) }
          }

          var $available { value = (!$is_weekend && !$is_day_off && $job_count < 5) }

          conditional {
            if ($available) {
              var $date_label { value = $day_start_ms|format_datetime:"D M j":"America/Chicago" }
              var $am_start  { value = ($day_start_ms + 50400000) } // 8am CT (UTC+5h = 13:00 UTC for CDT, simplified to +14h)
              var $mid_start { value = ($day_start_ms + 61200000) } // 11am
              var $pm_start  { value = ($day_start_ms + 72000000) } // 2pm

              conditional {
                if ($job_count < 5 && $slot_count < $max) {
                  var $slot_am {
                    value = {
                      label             : $date_label ~ ", 8am-11am"
                      scheduled_start_ms: $am_start
                      window            : "8am-11am"
                    }
                  }
                  var $slots { value = $slots|push:$slot_am }
                  var $slot_count { value = ($slot_count + 1) }
                }
              }
              conditional {
                if ($job_count < 5 && $slot_count < $max) {
                  var $slot_mid {
                    value = {
                      label             : $date_label ~ ", 11am-2pm"
                      scheduled_start_ms: $mid_start
                      window            : "11am-2pm"
                    }
                  }
                  var $slots { value = $slots|push:$slot_mid }
                  var $slot_count { value = ($slot_count + 1) }
                }
              }
              conditional {
                if ($job_count < 5 && $slot_count < $max) {
                  var $slot_pm {
                    value = {
                      label             : $date_label ~ ", 2pm-5pm"
                      scheduled_start_ms: $pm_start
                      window            : "2pm-5pm"
                    }
                  }
                  var $slots { value = $slots|push:$slot_pm }
                  var $slot_count { value = ($slot_count + 1) }
                }
              }
            }
          }
          var $day_idx { value = ($day_idx + 1) }
        }
      }
    }
  }

  response = {
    technician_id: $input.technician_id
    slots        : $slots
    count        : $slot_count
  }

  guid = "get-tech-slots-for-zip-v1"
}
