// Resolves a vendor claim number (or dispatch ID) to a job_id. Used by
// the warranty-status-gmail-watcher to translate "claim XXX paid" emails
// into the right job_id for record_warranty_submission. Optionally
// narrows by vendor when provided (loose match — substring on
// warranty_company lower-case).
query find_job_by_claim_number verb=GET {
  api_group = "intake"

  input {
    text claim_number filters=trim
    text? vendor?
  }

  stack {
    var $needle  { value = ($input.claim_number|upper) }
    var $vendor_n { value = (($input.vendor ?? "")|trim|lower) }

    precondition ($needle != "") {
      error_type = "inputerror"
      error = "claim_number is required"
    }

    // Try claim_number first (most common in our data), then
    // dispatch_source_id (ServicePower / SquareTrade).
    db.query jobs {
      where = $db.jobs.claim_number == $needle
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $by_ahs

    db.query jobs {
      where = $db.jobs.dispatch_source_id == $needle
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $by_dispatch

    var $candidates { value = [] }

    foreach ($by_ahs.items) {
      each as $j {
        var.update $candidates {
          value = $candidates|push:{
            job_id           : $j.id
            warranty_company : ($j.warranty_company ?? "")
            customer_id      : ($j.customer_id ?? 0)
            match_field      : "claim_number"
          }
        }
      }
    }

    foreach ($by_dispatch.items) {
      each as $j {
        var.update $candidates {
          value = $candidates|push:{
            job_id           : $j.id
            warranty_company : ($j.warranty_company ?? "")
            customer_id      : ($j.customer_id ?? 0)
            match_field      : "dispatch_source_id"
          }
        }
      }
    }

    // If vendor narrows it, filter to substring matches.
    var $filtered { value = [] }
    conditional {
      if ($vendor_n != "") {
        foreach ($candidates) {
          each as $c {
            var $c_v { value = (($c.warranty_company ?? "")|lower) }
            var $stripped { value = $c_v|replace:$vendor_n:"" }
            var $len_a { value = $c_v|strlen }
            var $len_b { value = $stripped|strlen }
            conditional {
              if ($len_b < $len_a) {
                var.update $filtered { value = $filtered|push:$c }
              }
            }
          }
        }
      }
    }

    var $final { value = ($vendor_n != "") ? $filtered : $candidates }
    var $count { value = $final|count }
    var $first { value = (($final|first) ?? null) }
  }

  response = {
    success    : true
    claim      : $input.claim_number
    vendor     : $vendor_n
    candidates : $final
    count      : $count
    best       : $first
  }

  guid = "find-job-by-claim-number-v1"
}
