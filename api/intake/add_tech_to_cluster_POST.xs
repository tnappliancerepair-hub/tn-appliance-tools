//  Adds a tech to a cluster's coverage: (1) appends the tech's first name to
//  allowed_technicians on every service_zone in that cluster (so the office can
//  assign them there + it shows as their area), and (2) upserts a
//  cluster_assignment row (so routing knows they cover it). Idempotent —
//  re-running won't double-add. Reusable for any coverage change.
//
//  First use: John (tech 6) → "LA North" (the whole North Shore: Hammond,
//  Covington, Mandeville, Slidell, Ponchatoula...), rank 2 (coverage alongside
//  Billy as primary).
query add_tech_to_cluster verb=POST {
  api_group = "intake"

  input {
    int technician_id
    text tech_name
    text cluster
    int? rank?
  }

  stack {
    var $name { value = (($input.tech_name ?? "")|trim) }
    var $cl   { value = (($input.cluster ?? "")|trim) }
    precondition ($input.technician_id > 0 && $name != "" && $cl != "") {
      error_type = "inputerror"
      error = "technician_id, tech_name, cluster required"
    }
    var $rank { value = ($input.rank ?? 2) }

    db.query service_zone {
      where = $db.service_zone.cluster == $cl
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $zones

    var $updated { value = 0 }
    foreach ($zones.items) {
      each as $z {
        var $allowed { value = (($z.allowed_technicians ?? "")|trim) }
        var $already { value = ($allowed|contains:$name) }
        conditional {
          if (!$already) {
            var $new_allowed { value = ($allowed == "") ? $name : ($allowed ~ "|" ~ $name) }
            db.edit service_zone {
              field_name = "id"
              field_value = $z.id
              data = { allowed_technicians: $new_allowed }
            }
            var.update $updated { value = ($updated + 1) }
          }
        }
      }
    }

    // Upsert the cluster_assignment so routing knows this tech covers it.
    db.query cluster_assignment {
      where = $db.cluster_assignment.cluster == $cl && $db.cluster_assignment.technician_id == $input.technician_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $ca
    var $ca_existing { value = (($ca.items|first) ?? null) }
    conditional {
      if ($ca_existing == null) {
        db.add cluster_assignment {
          data = {
            cluster      : $cl
            technician_id : $input.technician_id
            rank         : $rank
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "tech_added_to_cluster"
        metadata: {
          technician_id : $input.technician_id
          tech_name     : $name
          cluster       : $cl
          zones_updated : $updated
          rank          : $rank
        }
      }
    } as $log
  }

  response = {
    success       : true
    cluster       : $cl
    technician_id : $input.technician_id
    tech_name     : $name
    zones_updated : $updated
  }

  guid = "add-tech-to-cluster-v1"
}
