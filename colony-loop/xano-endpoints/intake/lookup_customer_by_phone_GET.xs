// Caller-resolution lookup. Strips formatting from the phone number
// and matches against customer.phone. Returns a lightweight customer
// summary the phone brain reads at call-start.
//
// Returns:
//   found: bool
//   customer: { id, first_name, last_name, phone, city, zip,
//               comms_style?, channel_pref?, preferred_language?,
//               ltv_usd?, total_jobs? }
query lookup_customer_by_phone verb=GET {
  api_group = "intake"

  input {
    text phone filters=trim
  }

  stack {
    precondition ($input.phone != "") {
      error_type = "inputerror"
      error      = "phone required"
    }

    // Normalize: strip everything but digits, take last 10
    var $digits { value = $input.phone|regex_replace:"[^0-9]":"" }
    var $needle { value = $digits|substr:-10:10 }

    db.query customer {
      filter {
        $this.phone contains $needle
      }
      sort = {created_at: "desc"}
      per_page = 1
    } as $rows

    var $cust { value = (($rows.items|first) ?? null) }
    var $found { value = ($cust != null) }

    // Pull materialized intel row if present (channel + style + lang)
    var $intel_meta { value = "" }
    conditional {
      if ($found) {
        var $intel_needle { value = "\"customer_id\":" ~ $cust.id }
        var $intel_cutoff { value = ((now|to_ms) - 172800000) }
        db.query event_log {
          filter {
            $this.action == "customer_intel"
            && $this.metadata contains $intel_needle
            && $this.created_at >= $intel_cutoff
          }
          sort = {created_at: "desc"}
          per_page = 1
        } as $intel_rows
        var $intel_top { value = (($intel_rows.items|first) ?? null) }
        conditional {
          if ($intel_top != null) {
            var $intel_meta { value = $intel_top.metadata }
          }
        }
      }
    }

    // Compose the response customer summary
    var $cust_out { value = null }
    conditional {
      if ($found) {
        var $cust_out {
          value = {
            id          : $cust.id
            first_name  : ($cust.first_name ?? "")
            last_name   : ($cust.last_name ?? "")
            phone       : ($cust.phone ?? "")
            city        : ($cust.city ?? "")
            zip_code    : ($cust.zip_code ?? "")
            email       : ($cust.email ?? "")
            intel_metadata: $intel_meta
          }
        }
      }
    }
  }

  response = {
    found    : $found
    customer : $cust_out
  }

  guid = "lookup-customer-by-phone-v1"
}
