// Records a payment received outside of Stripe (cash, check, Venmo,
// Zelle). Office logs these manually. Updates jobs.payment_collected +
// flips tech_earnings status when applicable.
query record_payment_received verb=POST {
  api_group = "intake"

  input {
    int job_id
    decimal amount
    text method
    text? reference?
    text? notes?
    int? recorded_by?
  }

  stack {
    var $method_clean {
      value = ($input.method ?? "cash")|trim|lower
    }

    db.get jobs {
      field_name  = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error      = "Job not found"
    }

    db.edit jobs {
      field_name  = "id"
      field_value = $input.job_id
      data        = {
        payment_collected      : true
        payment_status         : "paid"
      }
    } as $updated_job

    // Audit
    var $meta {
      value = {
        job_id      : $input.job_id
        amount      : $input.amount
        method      : $method_clean
        reference   : ($input.reference ?? "")
        notes       : ($input.notes ?? "")
        recorded_by : ($input.recorded_by ?? 0)
      }
    }

    db.add event_log {
      data = {
        action  : "payment_recorded_offline"
        metadata: $meta|json_encode
      }
    } as $audit

    // Backfill commission on the tech_earnings row
    db.query tech_earnings {
      where  = $db.tech_earnings.job_id == $input.job_id
      sort   = {tech_earnings.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $earn_rows

    var $earn {
      value = (($earn_rows.items|first) ?? null)
    }

    var $commission {
      value = 0
    }

    conditional {
      if ($earn != null) {
        var $rate {
          value = ($earn.commission_rate ?? 0.40)
        }

        var.update $commission {
          value = $input.amount * $rate
        }

        db.edit tech_earnings {
          field_name  = "id"
          field_value = $earn.id
          data        = {
            labor_amount      : $input.amount
            commission_earned : $commission
            total_earned      : $commission + ($earn.addon_commission ?? 0) + ($earn.parts_markup ?? 0)
          }
        } as $earn_upd
      }
    }
  }

  response = {
    success            : true
    job_id             : $input.job_id
    payment_method     : $method_clean
    commission_credited: $commission
  }

  guid = "record-payment-received-v1"
}
