// Returns the raw inbound SMS samples (body_preview only) for the
// channel-preference / comms-style engines to analyze in JS.
//
// We tried doing the detection in XS first but the string-length
// filter footguns made it brittle. JS-side classification is simpler
// + lets us evolve the heuristic without redeploying the endpoint.
query get_customer_comms_style verb=GET {
  api_group = "intake"

  input {
    int customer_id
    int? days_back?
    int? limit?
  }

  stack {
    precondition ($input.customer_id > 0) {
      error_type = "inputerror"
      error      = "customer_id required"
    }

    var $days     { value = ($input.days_back ?? 60) }
    var $cutoff_ms{ value = ((now|to_ms) - ($days * 86400000)) }
    var $needle   { value = "\"customer_id\":" ~ $input.customer_id }
    var $lim      { value = ($input.limit ?? 50) }

    db.query event_log {
      filter {
        $this.action == "inbound_customer_sms_received"
        && $this.metadata contains $needle
        && $this.created_at >= $cutoff_ms
      }
      sort = {created_at: "desc"}
      per_page = $lim
    } as $rows

    var $items { value = [] }
    var $count { value = 0 }
    foreach ($row in $rows.items) {
      var $entry { value = { metadata: $row.metadata } }
      var $items { value = $items|push:$entry }
      var $count { value = ($count + 1) }
    }
  }

  response = {
    customer_id: $input.customer_id
    items      : $items
    count      : $count
  }

  guid = "get-customer-comms-style-v1"
}
