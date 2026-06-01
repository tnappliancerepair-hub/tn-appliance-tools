// Seeds service zones across all 6 clusters.
query seed_service_zones verb=POST {
  api_group = "intake"

  input {
  }

  stack {
    db.query service_zone {
      return = {type: "count"}
    } as $zone_count
  
    conditional {
      if ($zone_count > 50) {
        return {
          value = {
            success      : false
            message      : "Service zones already expanded, skipping"
            current_count: $zone_count
          }
        }
      }
    }
  
    db.add service_zone {
      data = {
        zip_code              : "37040"
        state                 : "TN"
        market                : "Clarksville"
        zone                  : "Clarksville"
        cluster               : "TN Northwest"
        default_technician    : "Lee"
        technician_id         : 4
        allowed_technicians   : "Lee|Teddy|Jimmy"
        notes                 : "Clarksville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r1
  
    db.add service_zone {
      data = {
        zip_code              : "37041"
        state                 : "TN"
        market                : "Clarksville"
        zone                  : "Clarksville"
        cluster               : "TN Northwest"
        default_technician    : "Lee"
        technician_id         : 4
        allowed_technicians   : "Lee|Teddy|Jimmy"
        notes                 : "Clarksville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r2
  
    db.add service_zone {
      data = {
        zip_code              : "37042"
        state                 : "TN"
        market                : "Clarksville"
        zone                  : "Clarksville"
        cluster               : "TN Northwest"
        default_technician    : "Lee"
        technician_id         : 4
        allowed_technicians   : "Lee|Teddy|Jimmy"
        notes                 : "Clarksville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r3
  
    db.add service_zone {
      data = {
        zip_code              : "37043"
        state                 : "TN"
        market                : "Clarksville"
        zone                  : "Clarksville"
        cluster               : "TN Northwest"
        default_technician    : "Lee"
        technician_id         : 4
        allowed_technicians   : "Lee|Teddy|Jimmy"
        notes                 : "Clarksville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r4
  
    db.add service_zone {
      data = {
        zip_code              : "37044"
        state                 : "TN"
        market                : "Clarksville"
        zone                  : "Clarksville"
        cluster               : "TN Northwest"
        default_technician    : "Lee"
        technician_id         : 4
        allowed_technicians   : "Lee|Teddy|Jimmy"
        notes                 : "Clarksville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r5
  
    db.add service_zone {
      data = {
        zip_code              : "37015"
        state                 : "TN"
        market                : "Ashland City"
        zone                  : "Ashland City"
        cluster               : "TN Northwest"
        default_technician    : "Lee"
        technician_id         : 4
        allowed_technicians   : "Lee|Teddy|Jimmy"
        notes                 : "Cheatham County"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r6
  
    db.add service_zone {
      data = {
        zip_code              : "37146"
        state                 : "TN"
        market                : "Pleasant View"
        zone                  : "Pleasant View"
        cluster               : "TN Northwest"
        default_technician    : "Lee"
        technician_id         : 4
        allowed_technicians   : "Lee|Teddy|Jimmy"
        notes                 : "Cheatham County"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r7
  
    db.add service_zone {
      data = {
        zip_code              : "37082"
        state                 : "TN"
        market                : "Kingston Springs"
        zone                  : "Kingston Springs"
        cluster               : "TN Northwest"
        default_technician    : "Lee"
        technician_id         : 4
        allowed_technicians   : "Lee|Teddy|Jimmy"
        notes                 : "Cheatham County"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r8
  
    db.add service_zone {
      data = {
        zip_code              : "37172"
        state                 : "TN"
        market                : "Springfield"
        zone                  : "Springfield"
        cluster               : "TN Northwest"
        default_technician    : "Lee"
        technician_id         : 4
        allowed_technicians   : "Lee|Teddy|Jimmy"
        notes                 : "Robertson County"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r9
  
    db.add service_zone {
      data = {
        zip_code              : "37073"
        state                 : "TN"
        market                : "Greenbrier"
        zone                  : "Greenbrier"
        cluster               : "TN Northwest"
        default_technician    : "Lee"
        technician_id         : 4
        allowed_technicians   : "Lee|Teddy|Jimmy"
        notes                 : "Robertson County"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r10
  
    db.add service_zone {
      data = {
        zip_code              : "37188"
        state                 : "TN"
        market                : "White House"
        zone                  : "White House"
        cluster               : "TN Northwest"
        default_technician    : "Lee"
        technician_id         : 4
        allowed_technicians   : "Lee|Teddy|Jimmy"
        notes                 : "Robertson County"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r11
  
    db.add service_zone {
      data = {
        zip_code              : "37032"
        state                 : "TN"
        market                : "Cedar Hill"
        zone                  : "Cedar Hill"
        cluster               : "TN Northwest"
        default_technician    : "Lee"
        technician_id         : 4
        allowed_technicians   : "Lee|Teddy|Jimmy"
        notes                 : "Robertson County"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r12
  
    db.add service_zone {
      data = {
        zip_code              : "37064"
        state                 : "TN"
        market                : "Franklin"
        zone                  : "Franklin"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "Franklin"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r13
  
    db.add service_zone {
      data = {
        zip_code              : "37067"
        state                 : "TN"
        market                : "Franklin"
        zone                  : "Franklin"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "Franklin"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r14
  
    db.add service_zone {
      data = {
        zip_code              : "37069"
        state                 : "TN"
        market                : "Franklin"
        zone                  : "Franklin"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "Franklin"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r15
  
    db.add service_zone {
      data = {
        zip_code              : "37027"
        state                 : "TN"
        market                : "Brentwood"
        zone                  : "Brentwood"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "Williamson"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r16
  
    db.add service_zone {
      data = {
        zip_code              : "37135"
        state                 : "TN"
        market                : "Nolensville"
        zone                  : "Nolensville"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "Williamson"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r17
  
    db.add service_zone {
      data = {
        zip_code              : "37179"
        state                 : "TN"
        market                : "Spring Hill"
        zone                  : "Spring Hill"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "Williamson"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r18
  
    db.add service_zone {
      data = {
        zip_code              : "37204"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "South Nashville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r19
  
    db.add service_zone {
      data = {
        zip_code              : "37215"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "South Nashville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r20
  
    db.add service_zone {
      data = {
        zip_code              : "37220"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "South Nashville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r21
  
    db.add service_zone {
      data = {
        zip_code              : "37221"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "West Nashville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r22
  
    db.add service_zone {
      data = {
        zip_code              : "37205"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "West Nashville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r23
  
    db.add service_zone {
      data = {
        zip_code              : "37209"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "West Nashville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r24
  
    db.add service_zone {
      data = {
        zip_code              : "37218"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "North Nashville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r25
  
    db.add service_zone {
      data = {
        zip_code              : "37115"
        state                 : "TN"
        market                : "Madison"
        zone                  : "Madison"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "Madison"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r26
  
    db.add service_zone {
      data = {
        zip_code              : "37072"
        state                 : "TN"
        market                : "Goodlettsville"
        zone                  : "Goodlettsville"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "Goodlettsville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r27
  
    db.add service_zone {
      data = {
        zip_code              : "37080"
        state                 : "TN"
        market                : "Joelton"
        zone                  : "Joelton"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "Joelton"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r28
  
    db.add service_zone {
      data = {
        zip_code              : "37189"
        state                 : "TN"
        market                : "Whites Creek"
        zone                  : "Whites Creek"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "Whites Creek"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r29
  
    db.add service_zone {
      data = {
        zip_code              : "37207"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "North Nashville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r30
  
    db.add service_zone {
      data = {
        zip_code              : "37208"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "North Nashville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r31
  
    db.add service_zone {
      data = {
        zip_code              : "37228"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN Metro"
        default_technician    : "Teddy"
        technician_id         : 1
        allowed_technicians   : "Teddy|Lee|Jimmy"
        notes                 : "MetroCenter"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r32
  
    db.add service_zone {
      data = {
        zip_code              : "37075"
        state                 : "TN"
        market                : "Hendersonville"
        zone                  : "Hendersonville"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Sumner"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r33
  
    db.add service_zone {
      data = {
        zip_code              : "37066"
        state                 : "TN"
        market                : "Gallatin"
        zone                  : "Gallatin"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Sumner"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r34
  
    db.add service_zone {
      data = {
        zip_code              : "37031"
        state                 : "TN"
        market                : "Castalian Springs"
        zone                  : "Castalian Springs"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Sumner"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r35
  
    db.add service_zone {
      data = {
        zip_code              : "37048"
        state                 : "TN"
        market                : "Cottontown"
        zone                  : "Cottontown"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Sumner"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r36
  
    db.add service_zone {
      data = {
        zip_code              : "37122"
        state                 : "TN"
        market                : "Mt Juliet"
        zone                  : "Mt Juliet"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Wilson"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r37
  
    db.add service_zone {
      data = {
        zip_code              : "37087"
        state                 : "TN"
        market                : "Lebanon"
        zone                  : "Lebanon"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Wilson"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r38
  
    db.add service_zone {
      data = {
        zip_code              : "37090"
        state                 : "TN"
        market                : "Lebanon"
        zone                  : "Lebanon"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Wilson"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r39
  
    db.add service_zone {
      data = {
        zip_code              : "37129"
        state                 : "TN"
        market                : "Murfreesboro"
        zone                  : "Murfreesboro"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Rutherford"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r40
  
    db.add service_zone {
      data = {
        zip_code              : "37130"
        state                 : "TN"
        market                : "Murfreesboro"
        zone                  : "Murfreesboro"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Rutherford"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r41
  
    db.add service_zone {
      data = {
        zip_code              : "37128"
        state                 : "TN"
        market                : "Murfreesboro"
        zone                  : "Murfreesboro"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Rutherford"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r42
  
    db.add service_zone {
      data = {
        zip_code              : "37127"
        state                 : "TN"
        market                : "Murfreesboro"
        zone                  : "Murfreesboro"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Rutherford"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r43
  
    db.add service_zone {
      data = {
        zip_code              : "37167"
        state                 : "TN"
        market                : "Smyrna"
        zone                  : "Smyrna"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Rutherford"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r44
  
    db.add service_zone {
      data = {
        zip_code              : "37086"
        state                 : "TN"
        market                : "La Vergne"
        zone                  : "La Vergne"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Rutherford"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r45
  
    db.add service_zone {
      data = {
        zip_code              : "37076"
        state                 : "TN"
        market                : "Hermitage"
        zone                  : "Hermitage"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "East Davidson"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r46
  
    db.add service_zone {
      data = {
        zip_code              : "37138"
        state                 : "TN"
        market                : "Old Hickory"
        zone                  : "Old Hickory"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "East Davidson"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r47
  
    db.add service_zone {
      data = {
        zip_code              : "37214"
        state                 : "TN"
        market                : "Donelson"
        zone                  : "Donelson"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "East Davidson"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r48
  
    db.add service_zone {
      data = {
        zip_code              : "37013"
        state                 : "TN"
        market                : "Antioch"
        zone                  : "Antioch"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Antioch"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r49
  
    db.add service_zone {
      data = {
        zip_code              : "37211"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "SE Nashville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r50
  
    db.add service_zone {
      data = {
        zip_code              : "37217"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Airport"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r51
  
    db.add service_zone {
      data = {
        zip_code              : "37210"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "East Nashville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r52
  
    db.add service_zone {
      data = {
        zip_code              : "37206"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "East Nashville"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r53
  
    db.add service_zone {
      data = {
        zip_code              : "37216"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Inglewood"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r54
  
    db.add service_zone {
      data = {
        zip_code              : "37212"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Hillsboro"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r55
  
    db.add service_zone {
      data = {
        zip_code              : "37203"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Midtown"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r56
  
    db.add service_zone {
      data = {
        zip_code              : "37219"
        state                 : "TN"
        market                : "Nashville"
        zone                  : "Nashville"
        cluster               : "TN East"
        default_technician    : "Jimmy"
        technician_id         : 2
        allowed_technicians   : "Jimmy|Teddy|Andre"
        notes                 : "Downtown"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r57
  
    db.add service_zone {
      data = {
        zip_code              : "70458"
        state                 : "LA"
        market                : "Slidell"
        zone                  : "Slidell"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "North Shore"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r58
  
    db.add service_zone {
      data = {
        zip_code              : "70433"
        state                 : "LA"
        market                : "Covington"
        zone                  : "Covington"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "North Shore"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r59
  
    db.add service_zone {
      data = {
        zip_code              : "70471"
        state                 : "LA"
        market                : "Mandeville"
        zone                  : "Mandeville"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "North Shore"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r60
  
    db.add service_zone {
      data = {
        zip_code              : "70448"
        state                 : "LA"
        market                : "Mandeville"
        zone                  : "Mandeville"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "North Shore"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r61
  
    db.add service_zone {
      data = {
        zip_code              : "70447"
        state                 : "LA"
        market                : "Madisonville"
        zone                  : "Madisonville"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "North Shore"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r62
  
    db.add service_zone {
      data = {
        zip_code              : "70420"
        state                 : "LA"
        market                : "Abita Springs"
        zone                  : "Abita Springs"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "North Shore"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r63
  
    db.add service_zone {
      data = {
        zip_code              : "70445"
        state                 : "LA"
        market                : "Lacombe"
        zone                  : "Lacombe"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "North Shore"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r64
  
    db.add service_zone {
      data = {
        zip_code              : "70452"
        state                 : "LA"
        market                : "Pearl River"
        zone                  : "Pearl River"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "North Shore"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r65
  
    db.add service_zone {
      data = {
        zip_code              : "70437"
        state                 : "LA"
        market                : "Folsom"
        zone                  : "Folsom"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "North Shore"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r66
  
    db.add service_zone {
      data = {
        zip_code              : "70431"
        state                 : "LA"
        market                : "Bush"
        zone                  : "Bush"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "North Shore"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r67
  
    db.add service_zone {
      data = {
        zip_code              : "70403"
        state                 : "LA"
        market                : "Hammond"
        zone                  : "Hammond"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "Hammond hub"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r68
  
    db.add service_zone {
      data = {
        zip_code              : "70401"
        state                 : "LA"
        market                : "Hammond"
        zone                  : "Hammond"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "Hammond hub"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r69
  
    db.add service_zone {
      data = {
        zip_code              : "70454"
        state                 : "LA"
        market                : "Ponchatoula"
        zone                  : "Ponchatoula"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "Tangipahoa"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r70
  
    db.add service_zone {
      data = {
        zip_code              : "70422"
        state                 : "LA"
        market                : "Amite"
        zone                  : "Amite"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "Tangipahoa"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r71
  
    db.add service_zone {
      data = {
        zip_code              : "70443"
        state                 : "LA"
        market                : "Independence"
        zone                  : "Independence"
        cluster               : "LA North"
        default_technician    : "Billy"
        technician_id         : 5
        allowed_technicians   : "Billy|Andre|John"
        notes                 : "Tangipahoa"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r72
  
    db.add service_zone {
      data = {
        zip_code              : "70785"
        state                 : "LA"
        market                : "Walker"
        zone                  : "Walker"
        cluster               : "LA West"
        default_technician    : "John"
        technician_id         : 6
        allowed_technicians   : "John|Billy|Andre"
        notes                 : "Livingston"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r73
  
    db.add service_zone {
      data = {
        zip_code              : "70706"
        state                 : "LA"
        market                : "Denham Springs"
        zone                  : "Denham Springs"
        cluster               : "LA West"
        default_technician    : "John"
        technician_id         : 6
        allowed_technicians   : "John|Billy|Andre"
        notes                 : "Livingston"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r74
  
    db.add service_zone {
      data = {
        zip_code              : "70754"
        state                 : "LA"
        market                : "Livingston"
        zone                  : "Livingston"
        cluster               : "LA West"
        default_technician    : "John"
        technician_id         : 6
        allowed_technicians   : "John|Billy|Andre"
        notes                 : "Livingston"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r75
  
    db.add service_zone {
      data = {
        zip_code              : "70711"
        state                 : "LA"
        market                : "Albany"
        zone                  : "Albany"
        cluster               : "LA West"
        default_technician    : "John"
        technician_id         : 6
        allowed_technicians   : "John|Billy|Andre"
        notes                 : "Livingston"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r76
  
    db.add service_zone {
      data = {
        zip_code              : "70810"
        state                 : "LA"
        market                : "Baton Rouge"
        zone                  : "Baton Rouge"
        cluster               : "LA West"
        default_technician    : "John"
        technician_id         : 6
        allowed_technicians   : "John|Billy|Andre"
        notes                 : "Baton Rouge"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r77
  
    db.add service_zone {
      data = {
        zip_code              : "70802"
        state                 : "LA"
        market                : "Baton Rouge"
        zone                  : "Baton Rouge"
        cluster               : "LA West"
        default_technician    : "John"
        technician_id         : 6
        allowed_technicians   : "John|Billy|Andre"
        notes                 : "Baton Rouge"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r78
  
    db.add service_zone {
      data = {
        zip_code              : "70806"
        state                 : "LA"
        market                : "Baton Rouge"
        zone                  : "Baton Rouge"
        cluster               : "LA West"
        default_technician    : "John"
        technician_id         : 6
        allowed_technicians   : "John|Billy|Andre"
        notes                 : "Baton Rouge"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r79
  
    db.add service_zone {
      data = {
        zip_code              : "70815"
        state                 : "LA"
        market                : "Baton Rouge"
        zone                  : "Baton Rouge"
        cluster               : "LA West"
        default_technician    : "John"
        technician_id         : 6
        allowed_technicians   : "John|Billy|Andre"
        notes                 : "Baton Rouge"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r80
  
    db.add service_zone {
      data = {
        zip_code              : "70814"
        state                 : "LA"
        market                : "Baton Rouge"
        zone                  : "Baton Rouge"
        cluster               : "LA West"
        default_technician    : "John"
        technician_id         : 6
        allowed_technicians   : "John|Billy|Andre"
        notes                 : "Baton Rouge"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r81
  
    db.add service_zone {
      data = {
        zip_code              : "70769"
        state                 : "LA"
        market                : "Prairieville"
        zone                  : "Prairieville"
        cluster               : "LA West"
        default_technician    : "John"
        technician_id         : 6
        allowed_technicians   : "John|Billy|Andre"
        notes                 : "Ascension"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r82
  
    db.add service_zone {
      data = {
        zip_code              : "70115"
        state                 : "LA"
        market                : "New Orleans"
        zone                  : "New Orleans"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Uptown"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r83
  
    db.add service_zone {
      data = {
        zip_code              : "70118"
        state                 : "LA"
        market                : "New Orleans"
        zone                  : "New Orleans"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Uptown"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r84
  
    db.add service_zone {
      data = {
        zip_code              : "70119"
        state                 : "LA"
        market                : "New Orleans"
        zone                  : "New Orleans"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Mid-City"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r85
  
    db.add service_zone {
      data = {
        zip_code              : "70124"
        state                 : "LA"
        market                : "New Orleans"
        zone                  : "New Orleans"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Lakeview"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r86
  
    db.add service_zone {
      data = {
        zip_code              : "70117"
        state                 : "LA"
        market                : "New Orleans"
        zone                  : "New Orleans"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Bywater"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r87
  
    db.add service_zone {
      data = {
        zip_code              : "70116"
        state                 : "LA"
        market                : "New Orleans"
        zone                  : "New Orleans"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Marigny"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r88
  
    db.add service_zone {
      data = {
        zip_code              : "70130"
        state                 : "LA"
        market                : "New Orleans"
        zone                  : "New Orleans"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "CBD"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r89
  
    db.add service_zone {
      data = {
        zip_code              : "70122"
        state                 : "LA"
        market                : "New Orleans"
        zone                  : "New Orleans"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Gentilly"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r90
  
    db.add service_zone {
      data = {
        zip_code              : "70001"
        state                 : "LA"
        market                : "Metairie"
        zone                  : "Metairie"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Metairie"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r91
  
    db.add service_zone {
      data = {
        zip_code              : "70002"
        state                 : "LA"
        market                : "Metairie"
        zone                  : "Metairie"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Metairie"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r92
  
    db.add service_zone {
      data = {
        zip_code              : "70003"
        state                 : "LA"
        market                : "Metairie"
        zone                  : "Metairie"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Metairie"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r93
  
    db.add service_zone {
      data = {
        zip_code              : "70005"
        state                 : "LA"
        market                : "Metairie"
        zone                  : "Metairie"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Metairie"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r94
  
    db.add service_zone {
      data = {
        zip_code              : "70006"
        state                 : "LA"
        market                : "Metairie"
        zone                  : "Metairie"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Metairie"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r95
  
    db.add service_zone {
      data = {
        zip_code              : "70065"
        state                 : "LA"
        market                : "Kenner"
        zone                  : "Kenner"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Kenner"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r96
  
    db.add service_zone {
      data = {
        zip_code              : "70062"
        state                 : "LA"
        market                : "Kenner"
        zone                  : "Kenner"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Kenner"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r97
  
    db.add service_zone {
      data = {
        zip_code              : "70123"
        state                 : "LA"
        market                : "Harahan"
        zone                  : "Harahan"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Harahan"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r98
  
    db.add service_zone {
      data = {
        zip_code              : "70121"
        state                 : "LA"
        market                : "Jefferson"
        zone                  : "Jefferson"
        cluster               : "LA South"
        default_technician    : "Andre"
        technician_id         : 3
        allowed_technicians   : "Andre|Billy|John"
        notes                 : "Jefferson"
        zone_type             : "standard"
        active                : true
        accept_new_jobs       : true
        requires_manual_review: false
        min_jobs_required     : 0
        max_jobs_per_window   : 6
        allowed_time_windows  : "8-11|9-12|10-1|1-4"
        blocked_time_windows  : ""
        routing_priority      : 10
      }
    } as $r99
  }

  response = {
    success         : true
    records_inserted: 98
    message         : "Service zones seeded. Duplicates may exist if some zips were pre-existing."
  }

  guid = "4o29uQEE8lZmH7mAt-QHjG7fOfM"
}