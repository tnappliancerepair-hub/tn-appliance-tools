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
      error      = "zip_code is required"
    }

    // First 5 chars only (US-style)
    var $zip5 {
      value = ($zip|strlen) > 5 ? ($zip|substr:0:5) : $zip
    }

    db.query service_zone {
      where  = $db.service_zone.zip_code == $zip5
      sort   = {service_zone.created_at: "desc"}
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
  }

  guid = "check-service-zone-v1"
}
