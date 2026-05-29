// Returns the most-recent fingerprint row for a vendor. Tech Assist
// (and any other agent prepping a warranty interaction) calls this
// before composing prompts/asks so the work prioritizes fields the
// vendor is most likely to reject without.
query get_warranty_vendor_fingerprint verb=GET {
  api_group = "intake"

  input {
    text vendor filters=trim
  }

  stack {
    precondition ($input.vendor != "") {
      error_type = "inputerror"
      error      = "vendor required"
    }

    var $needle {
      value = "\"vendor\":\"" ~ $input.vendor ~ "\""
    }
    var $cutoff_ms {
      value = ((now|to_ms) - 604800000)  // 7d freshness window
    }

    db.query event_log {
      filter {
        $this.action == "warranty_vendor_fingerprint"
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
    vendor   : $input.vendor
    found    : $found
    metadata : $meta
  }

  guid = "get-warranty-vendor-fingerprint-v1"
}
