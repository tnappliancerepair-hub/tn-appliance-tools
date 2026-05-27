// Backfills tech_earnings.commission_earned when a Stripe payment lands.
// Called from netlify/functions/stripe-webhook.js (via the existing
// stripe_checkout_session_completed Xano endpoint, OR directly).
//
// Inputs:
//   job_id    : the job that was paid
//   amount_paid_cents : how much was paid
//
// Logic:
//   - Find tech_earnings row for this job
//   - Compute commission_earned = amount_paid * commission_rate
//   - Update row + flip status to 'pending_payment' (already there) or
//     leave for payout_batch to flip to 'paid'
query backfill_commission_from_payment verb=POST {
  api_group = "intake"

  input {
    int job_id
    int amount_paid_cents
  }

  stack {
    precondition ($input.job_id > 0 && $input.amount_paid_cents > 0) {
      error_type = "inputerror"
      error      = "job_id + amount_paid_cents required"
    }

    var $amount_dollars {
      value = $input.amount_paid_cents / 100
    }

    // Find earnings row
    db.query tech_earnings {
      where  = $db.tech_earnings.job_id == $input.job_id
      sort   = {tech_earnings.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $earn_rows

    var $earn {
      value = (($earn_rows.items|first) ?? null)
    }

    conditional {
      if ($earn == null) {
        return {
          value = {success: false, error: "no_earnings_row_for_job", job_id: $input.job_id}
        }
      }
    }

    var $rate {
      value = ($earn.commission_rate ?? 0.40)
    }

    var $commission {
      value = $amount_dollars * $rate
    }

    db.edit tech_earnings {
      field_name  = "id"
      field_value = $earn.id
      data        = {
        labor_amount     : $amount_dollars
        commission_earned: $commission
        total_earned     : $commission + ($earn.addon_commission ?? 0) + ($earn.parts_markup ?? 0)
      }
    } as $updated

    db.add event_log {
      data = {
        action  : "commission_backfilled_from_payment"
        metadata: {
          job_id            : $input.job_id
          tech_earnings_id  : $earn.id
          amount_paid_cents : $input.amount_paid_cents
          commission_rate   : $rate
          commission_earned : $commission
        }|json_encode
      }
    } as $audit_row
  }

  response = {
    success           : true
    tech_earnings_id  : $earn.id
    commission_earned : $commission
    commission_rate   : $rate
  }

  guid = "backfill-commission-from-payment-v1"
}
