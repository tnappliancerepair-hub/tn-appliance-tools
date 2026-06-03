// CSC tool — Ant calls this when ANY reference number is given:
//   - AHS-style claim number → jobs.claim_number
//   - ServicePower-style dispatch number → jobs.dispatch_source_id
//   - HCP work order number (visible to operators) → jobs.job_number  ← e.g. "22818", "22280-3"
//   - HCP internal id (UUID) → jobs.housecall_pro_job_id
//   - Ant internal job id → jobs.id (numeric)
//
// Strategy: try each lookup in turn, dedupe, return the matches. Almost
// always one row, occasionally none (CSC misspoke or wrong vendor),
// rarely multiple.
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

    // Pass 1 — exact match on jobs.claim_number (AHS-style)
    db.query jobs {
      where = $db.jobs.claim_number == $key
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $by_claim

    // Pass 2 — exact match on jobs.dispatch_source_id (ServicePower-style)
    db.query jobs {
      where = $db.jobs.dispatch_source_id == $key
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $by_dispatch

    // Pass 3a — exact match on jobs.job_number (HCP work order, human-readable)
    db.query jobs {
      where = $db.jobs.job_number == $key
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $by_jobnum

    // Pass 3b — exact match on jobs.housecall_pro_job_id (HCP internal UUID)
    db.query jobs {
      where = $db.jobs.housecall_pro_job_id == $key
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $by_hcp

    // Pass 4 — if the key is numeric, try jobs.id directly (Ant internal id)
    var $key_digits {
      value = "/[^0-9]/"|regex_replace:"":$key
    }
    var $key_is_numeric {
      value = ($key_digits|strlen) == ($key|strlen) && ($key_digits|strlen) > 0
    }
    var $by_id_items {
      value = []
    }
    conditional {
      if ($key_is_numeric == true) {
        var $key_int {
          value = $key_digits|to_int
        }
        db.get jobs {
          field_name = "id"
          field_value = $key_int
        } as $by_id_row
        conditional {
          if ($by_id_row != null) {
            var.update $by_id_items {
              value = [$by_id_row]
            }
          }
        }
      }
    }

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
        var $already2 {
          value = $seen_ids|contains:$jid2
        }
        conditional {
          if ($jid2 > 0 && $already2 == false) {
            var.update $matches {
              value = $matches|push:$j
            }
            var.update $seen_ids {
              value = $seen_ids|push:$jid2
            }
          }
        }
      }
    }

    foreach ($by_jobnum.items) {
      each as $j {
        var $jid_jn {
          value = ($j.id ?? 0)
        }
        var $already_jn {
          value = $seen_ids|contains:$jid_jn
        }
        conditional {
          if ($jid_jn > 0 && $already_jn == false) {
            var.update $matches {
              value = $matches|push:$j
            }
            var.update $seen_ids {
              value = $seen_ids|push:$jid_jn
            }
          }
        }
      }
    }

    foreach ($by_hcp.items) {
      each as $j {
        var $jid3 {
          value = ($j.id ?? 0)
        }
        var $already3 {
          value = $seen_ids|contains:$jid3
        }
        conditional {
          if ($jid3 > 0 && $already3 == false) {
            var.update $matches {
              value = $matches|push:$j
            }
            var.update $seen_ids {
              value = $seen_ids|push:$jid3
            }
          }
        }
      }
    }

    foreach ($by_id_items) {
      each as $j {
        var $jid4 {
          value = ($j.id ?? 0)
        }
        var $already4 {
          value = $seen_ids|contains:$jid4
        }
        conditional {
          if ($jid4 > 0 && $already4 == false) {
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
        metadata: ({key: $key, match_count: $match_count, primary_job_id: $primary_job_id, key_was_numeric: $key_is_numeric}|json_encode)
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
