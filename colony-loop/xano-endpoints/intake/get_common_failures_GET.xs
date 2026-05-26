// Returns the proprietary failure-mode catalog accumulated from every
// submitted TDR. Filter by (appliance_type, brand, model_number) to
// surface "for this exact brand+model, the most common failures are X,
// Y, Z with parts A, B, C" — used by diagnose_*.js and Teddy Tool to
// pre-populate likely-failure suggestions before the tech rolls.
//
// All inputs are optional; the response is filtered by whichever are
// provided. Returns count-grouped entries with the most recent
// verified_part_number for each (failed_component, failure_cause) pair.
query get_common_failures verb=GET {
  api_group = "intake"

  input {
    text? appliance_type?
    text? brand?
    text? model_number?
    int? per_page?
  }

  stack {
    var $pp {
      value = ($input.per_page ?? 50)
    }

    var $appl {
      value = (($input.appliance_type ?? "")|trim)|lower
    }

    var $brand {
      value = (($input.brand ?? "")|trim)|lower
    }

    var $model {
      value = ($input.model_number ?? "")|trim
    }

    // Pull all matching catalog entries. Filtering is done dynamically
    // in the where clause — empty input fields match anything via OR.
    db.query event_log {
      where = $db.event_log.action == "tdr_catalog_entry" && (($appl == "") || ($db.event_log.metadata.appliance_type == $appl)) && (($brand == "") || ($db.event_log.metadata.brand == $brand)) && (($model == "") || ($db.event_log.metadata.model_number == $model))
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $pp}}
    } as $rows

    // Project + dedup logic intentionally pushed client-side: the loop
    // agent that consumes this endpoint can group/count more flexibly
    // than XS allows.
    var $out {
      value = []
    }

    foreach ($rows.items) {
      each as $r {
        var $entry {
          value = {
            id              : $r.id
            created_at      : $r.created_at
            job_id          : ($r.metadata.job_id ?? 0)
            appliance_type  : ($r.metadata.appliance_type ?? "")
            brand           : ($r.metadata.brand ?? "")
            model_number    : ($r.metadata.model_number ?? "")
            failed_component: ($r.metadata.failed_component ?? "")
            failure_cause   : ($r.metadata.failure_cause ?? "")
            verified_part_number: ($r.metadata.verified_part_number ?? "")
          }
        }
        var.update $out {
          value = $out|push:$entry
        }
      }
    }
  }

  response = {
    success           : true
    filter_appliance  : $appl
    filter_brand      : $brand
    filter_model      : $model
    count             : ($out|count)
    entries           : $out
  }

  guid = "get-common-failures-v1"
}
