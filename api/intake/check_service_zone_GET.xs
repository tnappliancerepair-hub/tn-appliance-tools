// Returns whether a zip code is covered by our service area. Used by:
//   - Web chat intake to fail-fast on out-of-area
//   - Customer-facing pages for "do you cover my area?" lookups
//   - Marketing / SEO templates to surface coverage
query check_service_zone verb=GET {
  api_group = "intake"

  input {
    text zip_code
  }

  stack {
    var $zip {
      value = ($input.zip_code ?? "")|trim
    }
  
    precondition ($zip != "") {
      error_type = "inputerror"
      error = "zip_code is required"
    }
  
    // First 5 chars only (US-style)
    var $zip5 {
      value = ($zip|strlen) > 5 ? ($zip|substr:0:5) : $zip
    }
  
    db.query service_zone {
      where = $db.service_zone.zip_code == $zip5
      sort = {service_zone.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $zone_rows
  
    var $zone {
      value = (($zone_rows.items|first) ?? null)
    }
  
    var $covered {
      value = ($zone != null)
    }
  
    var $accepting {
      value = ($zone != null ? ($zone.accept_new_jobs ?? false) : false)
    }

    // Smart-routing suggestion: the rank-1 active tech who covers this cluster
    // (owner tech 1 skipped so routine work does not auto-route to Teddy). The
    // office confirms; a cluster only the owner covers returns 0 (pick by hand).
    var $cluster_name {
      value = ($zone != null ? ($zone.cluster ?? "") : "")
    }

    db.query cluster_assignment {
      where = $db.cluster_assignment.cluster == $cluster_name && $db.cluster_assignment.active == true && $db.cluster_assignment.technician_id != 1
      sort = {cluster_assignment.rank: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $assign_rows

    var $assign {
      value = (($assign_rows.items|first) ?? null)
    }

    var $suggested_tid {
      value = ($assign != null ? ($assign.technician_id ?? 0) : 0)
    }

    var $sug_name {
      value = ""
    }

    conditional {
      if ($suggested_tid > 0) {
        db.get technicians {
          field_name = "id"
          field_value = $suggested_tid
        } as $sug_tech

        var.update $sug_name {
          value = (($sug_tech ?? {first_name: ""}).first_name ?? "")
        }
      }
    }
  }

  response = {
    success           : true
    zip_code          : $zip5
    covered           : $covered
    accepting_new_jobs: $accepting
    market            : ($zone.market ?? "")
    zone              : ($zone.zone ?? "")
    cluster           : ($zone.cluster ?? "")
    state             : ($zone.state ?? "")
    notes             : ($zone.notes ?? "")
    suggested_technician_id : $suggested_tid
    suggested_tech_name     : $sug_name
  }

  guid = "check-service-zone-v1"
}