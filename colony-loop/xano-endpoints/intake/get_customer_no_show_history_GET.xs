// Returns customer's no-show + cancel history + portal/SMS engagement
// signals for the appointment_no_show_predictor scoring.
query get_customer_no_show_history verb=GET {
  api_group = "intake"

  input {
    int customer_id
  }

  stack {
    precondition ($input.customer_id > 0) {
      error_type = "inputerror"
      error      = "customer_id required"
    }

    db.get customer {
      field_name  = "id"
      field_value = $input.customer_id
    } as $cust

    var $cust_age_days {
      value = ($cust != null) ? (((now|to_ms) - $cust.created_at) / 86400000) : 0
    }

    // Count canceled jobs
    db.query jobs {
      filter {
        $this.customer_id == $input.customer_id
        && $this.scheduling_status == "canceled"
      }
      per_page = 50
    } as $cancel_rows

    var $cancellations { value = 0 }
    foreach ($r in $cancel_rows.items) {
      var $cancellations { value = ($cancellations + 1) }
    }

    // Count completed jobs (used for is_first_appt logic)
    db.query jobs {
      filter {
        $this.customer_id == $input.customer_id
        && $this.scheduling_status == "completed"
      }
      per_page = 50
    } as $completed_rows
    var $completed_count { value = 0 }
    foreach ($r in $completed_rows.items) {
      var $completed_count { value = ($completed_count + 1) }
    }
    var $is_first_appt { value = ($completed_count == 0) }

    // No-show count via event_log (no_show_flagged action)
    var $cid_needle { value = "\"customer_id\":" ~ $input.customer_id }
    db.query event_log {
      filter {
        $this.action == "no_show_flagged"
        && $this.metadata contains $cid_needle
      }
      per_page = 50
    } as $no_show_rows
    var $no_shows { value = 0 }
    foreach ($r in $no_show_rows.items) {
      var $no_shows { value = ($no_shows + 1) }
    }

    // Portal views in last 90d
    var $cutoff_90d { value = ((now|to_ms) - 7776000000) }
    db.query event_log {
      filter {
        $this.action == "portal_viewed"
        && $this.metadata contains $cid_needle
        && $this.created_at >= $cutoff_90d
      }
      per_page = 50
    } as $portal_rows
    var $portal_views_90d { value = 0 }
    foreach ($r in $portal_rows.items) {
      var $portal_views_90d { value = ($portal_views_90d + 1) }
    }

    // SMS replies in last 90d
    db.query event_log {
      filter {
        $this.action == "sms_reply_received"
        && $this.metadata contains $cid_needle
        && $this.created_at >= $cutoff_90d
      }
      per_page = 50
    } as $sms_rows
    var $sms_replies_90d { value = 0 }
    foreach ($r in $sms_rows.items) {
      var $sms_replies_90d { value = ($sms_replies_90d + 1) }
    }
  }

  response = {
    customer_id      : $input.customer_id
    customer_age_days: $cust_age_days
    no_shows         : $no_shows
    cancellations    : $cancellations
    completed_count  : $completed_count
    is_first_appt    : $is_first_appt
    portal_views_90d : $portal_views_90d
    sms_replies_90d  : $sms_replies_90d
  }

  guid = "get-customer-no-show-history-v1"
}
