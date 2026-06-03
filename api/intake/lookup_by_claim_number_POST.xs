// CSC tool — Vapi Ant Warranty Company Inbound calls this when a CSC
// rep gives a claim or dispatch number. Resolves to a single job + the
// customer + the assigned tech so the agent can answer instantly.
//
// Accepts EITHER:
//   - AHS-style claim number (e.g., "1234567890")
//   - ServicePower-style dispatch number (e.g., "SP-2024-00123")
//
// Strategy: query both jobs.claim_number AND jobs.dispatch_source_id,
// dedupe, return the matches. Almost always one row, occasionally none
// (CSC misspoke or wrong vendor), rarely multiple.
query lookup_by_claim_number verb=POST {
  api_group = "intake"

  input {
    text claim_or_dispatch_number
  }

  stack {
    var $key {
      value = (($input.claim_or_dispatch_number ?? "")|trim)
    }

    precondition ($key != "") {
      error_type = "inputerror"
      error = "claim_or_dispatch_number is required"
    }

    db.query jobs {
      where = $db.jobs.claim_number == $key
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $by_claim

    db.query jobs {
      where = $db.jobs.dispatch_source_id == $key
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $by_dispatch

    var $matches {
      value = []
    }
    var $seen_ids {
      value = []
    }

    foreach ($by_claim.items) {
      each as $j {
        var $jid {
          value = ($j.id ?? 0)
        }
        conditional {
          if ($jid > 0) {
            var.update $matches {
              value = $matches|push:$j
            }
            var.update $seen_ids {
              value = $seen_ids|push:$jid
            }
          }
        }
      }
    }

    foreach ($by_dispatch.items) {
      each as $j {
        var $jid2 {
          value = ($j.id ?? 0)
        }
        var $already {
          value = $seen_ids|in_array:$jid2
        }
        conditional {
          if ($jid2 > 0 && $already == false) {
            var.update $matches {
              value = $matches|push:$j
            }
          }
        }
      }
    }

    var $match_count {
      value = $matches|count
    }

    var $primary_customer {
      value = null
    }
    var $primary_tech {
      value = null
    }
    var $primary_job_id {
      value = 0
    }

    conditional {
      if ($match_count == 1) {
        var $first_match {
          value = (($matches|first) ?? null)
        }
        var.update $primary_job_id {
          value = ($first_match.id ?? 0)
        }
        var $cid {
          value = ($first_match.customer_id ?? 0)
        }
        var $tid {
          value = ($first_match.technician_id ?? 0)
        }
        conditional {
          if ($cid > 0) {
            db.get customer {
              field_name = "id"
              field_value = $cid
            } as $cust_row
            var.update $primary_customer {
              value = $cust_row
            }
          }
        }
        conditional {
          if ($tid > 0) {
            db.get technicians {
              field_name = "id"
              field_value = $tid
            } as $tech_row
            var.update $primary_tech {
              value = $tech_row
            }
          }
        }
      }
    }

    db.add event_log {
      data = {
        action  : "csc_tool_lookup_by_claim"
        metadata: ({key: $key, match_count: $match_count, primary_job_id: $primary_job_id}|json_encode)
      }
    }
  }

  response = {
    success    : true
    match_count: $match_count
    matches    : $matches
    primary_job_id: $primary_job_id
    customer   : $primary_customer
    tech       : $primary_tech
    lookup_key : $key
  }

  guid = "lookup-by-claim-number-v1"
}
