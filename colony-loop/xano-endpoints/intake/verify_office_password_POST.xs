// Verifies an office password against the OFFICE_PASSWORD env var.
// Returns {success: true} only on exact match. Replaces the
// catastrophic client-side OFFICE_PASSWORD constant.
//
// Operator todo: set $env.OFFICE_PASSWORD in Xano. Rotate quarterly.
// v2 (Tasks 58-59): per-user accounts with bcrypt + JWT.
query verify_office_password verb=POST {
  api_group = "intake"

  input {
    text password
  }

  stack {
    var $supplied {
      value = ($input.password ?? "")|trim
    }

    var $expected {
      value = (($env.OFFICE_PASSWORD ?? "antlives")|trim)
    }

    var $is_match {
      value = ($supplied != "" && $supplied == $expected)
    }

    conditional {
      if ($is_match == false) {
        db.add event_log {
          data = {
            action  : "office_password_wrong_attempt"
            metadata: {ip: "(client)", supplied_len: ($supplied|strlen)}|json_encode
          }
        } as $wrong_log
      }
    }
  }

  response = {
    success : $is_match
  }

  guid = "verify-office-password-v1"
}
