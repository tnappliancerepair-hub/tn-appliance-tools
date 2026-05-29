// Returns the latest materialized customer_intel row for a customer.
// Written nightly by customer_intel_refresh. Single fetch replaces
// 3-4 separate live lookups (channel_pref + comms_style + language +
// abuse_score). Stale up to 24h — fine for tone/preference; live
// abuse detection layers on top.
query get_customer_intel verb=GET {
  api_group = "intake"

  input {
    int customer_id
  }

  stack {
    precondition ($input.customer_id > 0) {
      error_type = "inputerror"
      error      = "customer_id required"
    }

    var $needle    { value = "\"customer_id\":" ~ $input.customer_id }
    var $cutoff_ms { value = ((now|to_ms) - 172800000) } // 48h freshness

    db.query event_log {
      filter {
        $this.action == "customer_intel"
        && $this.metadata contains $needle
        && $this.created_at >= $cutoff_ms
      }
      sort = {created_at: "desc"}
      per_page = 1
    } as $rows

    var $top { value = (($rows.items|first) ?? null) }
    var $found { value = ($top != null) }
    var $meta { value = ($found) ? $top.metadata : "" }
  }

  response = {
    customer_id: $input.customer_id
    found      : $found
    metadata   : $meta
  }

  guid = "get-customer-intel-v1"
}
