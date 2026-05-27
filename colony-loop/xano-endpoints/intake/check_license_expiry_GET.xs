// Returns techs whose license_expires_date is within N days. Schema note:
// technicians table needs license_expires_date column. Until added,
// returns empty array.
query check_license_expiry verb=GET {
  api_group = "intake"

  input {
    int? days_ahead?
  }

  stack {
    var $days {
      value = ($input.days_ahead ?? 60)
    }

    var $now_ct {
      value = now|transform_timestamp:"-5 hours"
    }

    var $cutoff_str {
      value = $now_ct|transform_timestamp:"+" ~ ($days|to_text) ~ " days"|format_timestamp:"Y-m-d"
    }

    var $today_str {
      value = $now_ct|format_timestamp:"Y-m-d"
    }

    db.query technicians {
      where  = $db.technicians.active == true && $db.technicians.id != 8
      sort   = {technicians.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $tech_rows

    var $out {
      value = []
    }

    foreach ($tech_rows.items) {
      each as $t {
        var $exp_str {
          value = (($t.license_expires_date ?? "") ?? "")|to_text|trim
        }

        conditional {
          if ($exp_str != "" && $exp_str <= $cutoff_str && $exp_str >= $today_str) {
            var $entry {
              value = {
                tech_id            : $t.id
                first_name         : ($t.first_name ?? "")
                last_name          : ($t.last_name ?? "")
                phone              : ($t.phone ?? "")
                license_expires_date: $exp_str
              }
            }

            var.update $out {
              value = $out|push:$entry
            }
          }
        }
      }
    }
  }

  response = {
    success     : true
    days_ahead  : $days
    today       : $today_str
    cutoff      : $cutoff_str
    expiring    : $out
  }

  guid = "check-license-expiry-v1"
}
