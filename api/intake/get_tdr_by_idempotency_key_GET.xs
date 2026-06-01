// GET TDR BY IDEMPOTENCY KEY
//
// Client-side dedup precheck for the offline TDR sync path.
// Offline page generates a stable client_idempotency_key per TDR;
// before POSTing to create_tdr it calls this endpoint. If a TDR
// with that key already exists, the offline page skips the POST
// and marks the local row synced. Keeps create_tdr simple.
//
// Read-only. No side effects.

query get_tdr_by_idempotency_key verb=GET {
  api_group = "intake"

  input {
    text client_idempotency_key filters=trim
  }

  stack {
    var $key {
      value = ($input.client_idempotency_key ?? "")
    }

    var $found {
      value = null
    }

    conditional {
      if ($key != "") {
        db.query technician_decision_report {
          where = $db.technician_decision_report.client_idempotency_key == $key
          return = {type: "list"}
        } as $rows

        var.update $found {
          value = (($rows|first) ?? null)
        }
      }
    }
  }

  response = {
    exists                 : ($found != null)
    tdr_id                 : (($found ?? {id: 0}).id)
    job_id                 : (($found ?? {job_id: null}).job_id)
    client_idempotency_key : $key
  }
}
