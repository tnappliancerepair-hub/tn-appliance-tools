// Returns a simple cashflow forecast for the next N days based on:
//   - confirmed completed jobs awaiting payment (will arrive ~7 days)
//   - scheduled jobs in next N days (probability-adjusted)
//   - active warranty submissions (will arrive ~30 days)
//
// v0 heuristics, no ML. Operator inputs avg_job_value tuning.
query get_cashflow_forecast verb=GET {
  api_group = "intake"

  input {
    int? days_ahead?
    decimal? avg_job_value?
  }

  stack {
    var $days {
      value = ($input.days_ahead ?? 30)
    }

    var $avg {
      value = ($input.avg_job_value ?? 250)
    }

    var $now_ts {
      value = now
    }

    var $window_end {
      value = $now_ts|transform_timestamp:"+" ~ ($days|to_text) ~ " days"
    }

    // 1. Self-pay completed awaiting payment
    db.query jobs {
      where  = $db.jobs.scheduling_status == "completed" && $db.jobs.customer_type == "self_pay" && $db.jobs.payment_collected == false
      return = {type: "count"}
    } as $unpaid_count

    // 2. Scheduled jobs in window
    db.query jobs {
      where  = $db.jobs.scheduling_status == "scheduled" && $db.jobs.scheduled_start >= $now_ts && $db.jobs.scheduled_start < $window_end
      return = {type: "count"}
    } as $scheduled_count

    // 3. Warranty submissions in flight (held + completed warranty)
    db.query jobs {
      where  = ($db.jobs.scheduling_status == "completed" || $db.jobs.scheduling_status == "held") && $db.jobs.customer_type == "warranty"
      return = {type: "count"}
    } as $warranty_in_flight_count

    // Forecast
    var $arriving_soon {
      value = ($unpaid_count ?? 0) * $avg
    }

    var $arriving_window {
      value = ($scheduled_count ?? 0) * $avg * 0.85
    }

    var $arriving_warranty {
      value = ($warranty_in_flight_count ?? 0) * $avg * 0.75
    }

    var $total {
      value = $arriving_soon + $arriving_window + $arriving_warranty
    }
  }

  response = {
    success                    : true
    days_ahead                 : $days
    avg_job_value              : $avg
    unpaid_self_pay_count      : ($unpaid_count ?? 0)
    scheduled_in_window_count  : ($scheduled_count ?? 0)
    warranty_in_flight_count   : ($warranty_in_flight_count ?? 0)
    arriving_soon_est          : $arriving_soon
    arriving_window_est        : $arriving_window
    arriving_warranty_est      : $arriving_warranty
    total_forecast             : $total
    note                       : "v0 heuristic forecast. Multiply scheduled by 0.85 (no-show factor) and warranty by 0.75 (denial factor)."
  }

  guid = "get-cashflow-forecast-v1"
}
