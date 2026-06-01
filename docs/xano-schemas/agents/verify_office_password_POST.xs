// Verifies an office password against the OFFICE_PASSWORD env var.
//
// 2026-05-30 v5 REVERT — token-session approach abandoned.
// Pages now hold the passcode and send it as ?key= to data endpoints
// which compare to $env.OFFICE_KEY. This verify endpoint exists only
// to give Danielle a "wrong passcode" message at unlock time before
// she sees an empty page.
//
// Returns {success: true} on match, {success: false} on mismatch.
// Wrong-attempt audit row written to event_log.
//
// XS rules: no em-dashes, no backticks, no try/catch, no raw if,
// every filter paren-wrapped, ?? only in value = (...).

query verify_office_password verb=POST {
  api_group = "intake"

  input {
    text password
  }

  stack {
    var $supplied {
      value = (($input.password ?? "")|trim)
    }

    var $expected {
      value = (($env.OFFICE_PASSWORD ?? "antlives")|trim)
    }

    var $is_match {
      value = ($supplied != "" && $supplied == $expected)
    }

    conditional {
      if ($is_match == false) {
        var $supplied_len {
          value = ($supplied|strlen)
        }

        var $wrong_meta_obj {
          value = {ip: "(client)", supplied_len: $supplied_len}
        }

        var $wrong_meta_str {
          value = ($wrong_meta_obj|json_encode)
        }

        db.add event_log {
          data = {
            action: "office_password_wrong_attempt"
            metadata: $wrong_meta_str
          }
        } as $wrong_log
      }
    }
  }

  response = {success: $is_match}

  guid = "verify-office-password-v1"
}
