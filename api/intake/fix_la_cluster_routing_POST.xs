// ONE-SHOT FIXER: corrects LA cluster routing leaks discovered 2026-06-02.
// 1. zip 70065 (Kenner) was wrongly assigned to tech 6 (John, LA West).
//    Reassigned to tech 3 (Andre, LA South).
// 2. Missing LA zones added: 70126 + 70131 (LA South), 70461 (LA North).
// Idempotent: dry_run=true reports the plan without writes.
query fix_la_cluster_routing verb=POST {
  api_group = "intake"

  input {
    bool? dry_run?
  }

  stack {
    var $is_dry {
      value = ($input.dry_run ?? false)
    }

    var $actions {
      value = []
    }

    // Step 1: fix 70065 (Kenner) — wrongly assigned to John
    db.query service_zone {
      where = $db.service_zone.zip_code == "70065"
      return = {type: "single"}
    } as $row_70065

    conditional {
      if ($row_70065 != null) {
        conditional {
          if (!$is_dry) {
            db.edit service_zone {
              field_name = "id"
              field_value = $row_70065.id
              data = {
                technician_id     : 3
                default_technician: "Andre"
                allowed_technicians: "Andre|Billy"
                notes             : "LA South — reassigned from John 2026-06-02 (cluster routing fix)"
              }
            }
          }
        }
        var.update $actions {
          value = $actions|push:"70065 Kenner: reassigned to Andre (tech 3)"
        }
      }
    }

    // Step 2: add 70126 (New Orleans East) if missing
    db.query service_zone {
      where = $db.service_zone.zip_code == "70126"
      return = {type: "single"}
    } as $row_70126

    conditional {
      if ($row_70126 == null) {
        conditional {
          if (!$is_dry) {
            db.add service_zone {
              data = {
                zip_code          : "70126"
                state             : "LA"
                market            : "New Orleans"
                zone              : "New Orleans East"
                cluster           : "LA South"
                default_technician: "Andre"
                allowed_technicians: "Andre|Billy"
                accept_new_jobs   : true
                requires_manual_review: false
                notes             : "added 2026-06-02 — was missing from coverage"
                zone_type         : "controlled"
                min_jobs_required : 0
                max_jobs_per_window: 6
                allowed_time_windows: "8-11|9-12|10-1|1-4"
                blocked_time_windows: ""
                active            : true
                routing_priority  : 50
                technician_id     : 3
              }
            }
          }
        }
        var.update $actions {
          value = $actions|push:"70126 New Orleans East: ADDED to LA South (Andre)"
        }
      }
    }

    // Step 3: add 70131 (Algiers) if missing
    db.query service_zone {
      where = $db.service_zone.zip_code == "70131"
      return = {type: "single"}
    } as $row_70131

    conditional {
      if ($row_70131 == null) {
        conditional {
          if (!$is_dry) {
            db.add service_zone {
              data = {
                zip_code          : "70131"
                state             : "LA"
                market            : "New Orleans"
                zone              : "Algiers"
                cluster           : "LA South"
                default_technician: "Andre"
                allowed_technicians: "Andre|Billy"
                accept_new_jobs   : true
                requires_manual_review: false
                notes             : "added 2026-06-02 — was missing from coverage"
                zone_type         : "controlled"
                min_jobs_required : 0
                max_jobs_per_window: 6
                allowed_time_windows: "8-11|9-12|10-1|1-4"
                blocked_time_windows: ""
                active            : true
                routing_priority  : 50
                technician_id     : 3
              }
            }
          }
        }
        var.update $actions {
          value = $actions|push:"70131 Algiers: ADDED to LA South (Andre)"
        }
      }
    }

    // Step 4: add 70461 (Slidell) if missing
    db.query service_zone {
      where = $db.service_zone.zip_code == "70461"
      return = {type: "single"}
    } as $row_70461

    conditional {
      if ($row_70461 == null) {
        conditional {
          if (!$is_dry) {
            db.add service_zone {
              data = {
                zip_code          : "70461"
                state             : "LA"
                market            : "New Orleans"
                zone              : "Slidell"
                cluster           : "LA North"
                default_technician: "Billy"
                allowed_technicians: "Billy"
                accept_new_jobs   : true
                requires_manual_review: false
                notes             : "added 2026-06-02 — was missing from coverage"
                zone_type         : "controlled"
                min_jobs_required : 0
                max_jobs_per_window: 6
                allowed_time_windows: "8-11|9-12|10-1|1-4"
                blocked_time_windows: ""
                active            : true
                routing_priority  : 50
                technician_id     : 5
              }
            }
          }
        }
        var.update $actions {
          value = $actions|push:"70461 Slidell: ADDED to LA North (Billy)"
        }
      }
    }

    db.add event_log {
      data = {
        action  : "service_zone_la_cluster_fix"
        metadata: {
        dry_run : $is_dry
        actions : $actions
      }
      }
    } as $log
  }

  response = {
    success: true
    dry_run: $is_dry
    actions: $actions
  }

  guid = "fix-la-cluster-routing-v1"
}
