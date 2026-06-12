//  Office invoice worksheet logger. Danielle logs the tech's requested labor
//  + the parts charge / markup / shipping / tax / tip breakdown on a job from
//  the Job Board card (office-board.html). Writes an event_log audit row so
//  there is a durable, searchable record without any schema change (the jobs
//  table doesn't carry invoice columns yet). When the financial layer is
//  trusted enough to auto-build invoices, this becomes the seed record.
//
//  Money fields arrive as strings (free-text $ entry) and are stored as-is.
//
//  XS rules: no em-dashes, no backticks, no try/catch, data = { } for db.add,
//  metadata is the JSON column on event_log.
query record_job_invoice verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? labor?
    text? parts_charge?
    text? markup?
    text? shipping?
    text? tax?
    text? tip?
    text? tech_pay?
    text? amount_invoiced?
    text? logged_by?
  }

  stack {
    precondition ($input.job_id > 0) {
      error_type = "inputerror"
      error = "job_id required"
    }

    var $now_ms {
      value = now|to_ms
    }

    db.add event_log {
      data = {
        action  : "office_invoice_logged"
        metadata: {
          job_id         : $input.job_id
          labor          : (($input.labor ?? "")|trim)
          parts_charge   : (($input.parts_charge ?? "")|trim)
          markup         : (($input.markup ?? "")|trim)
          shipping       : (($input.shipping ?? "")|trim)
          tax            : (($input.tax ?? "")|trim)
          tip            : (($input.tip ?? "")|trim)
          tech_pay       : (($input.tech_pay ?? "")|trim)
          amount_invoiced: (($input.amount_invoiced ?? "")|trim)
          logged_by      : (($input.logged_by ?? "office")|trim)
          logged_at_ms   : $now_ms
        }
      }
    } as $log
  }

  response = {
    success      : true
    job_id       : $input.job_id
    logged_at_ms : $now_ms
  }

  guid = "record-job-invoice-v1"
}
