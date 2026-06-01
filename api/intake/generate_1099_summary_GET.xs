// Returns 1099-NEC summary data per tech for a tax year. Office plugs
// the totals into IRS 1099-NEC forms (manual filing or via 3rd-party
// like Track1099).
query generate_1099_summary verb=GET {
  api_group = "intake"

  input {
    int? tax_year?
  }

  stack {
    var $year_in {
      value = ($input.tax_year ?? 0)
    }
  
    var $now_year {
      value = (now|format_timestamp:"Y")|to_int
    }
  
    var $year {
      value = ($year_in > 0 ? $year_in : ($now_year - 1))
    }
  
    var $year_start_str {
      value = ($year|to_text) ~ "-01-01 00:00:00"
    }
  
    var $year_end_str {
      value = (($year + 1)|to_text) ~ "-01-01 00:00:00"
    }
  
    var $year_start_ts {
      value = $year_start_str|to_timestamp
    }
  
    var $year_end_ts {
      value = $year_end_str|to_timestamp
    }
  
    db.query technicians {
      where = $db.technicians.active == true && $db.technicians.id != 8
      sort = {technicians.id: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $techs
  
    var $out {
      value = []
    }
  
    foreach ($techs.items) {
      each as $tech {
        db.query tech_earnings {
          where = $db.tech_earnings.tech_id == $tech.id && $db.tech_earnings.paid_at != null && $db.tech_earnings.paid_at >= $year_start_ts && $db.tech_earnings.paid_at < $year_end_ts
          return = {type: "list", paging: {page: 1, per_page: 1000}}
        } as $earn_rows
      
        var $total {
          value = 0
        }
      
        foreach ($earn_rows.items) {
          each as $e {
            var $row_sum {
              value = ($e.commission_earned ?? 0) + ($e.addon_commission ?? 0) + ($e.parts_markup ?? 0)
            }
          
            var.update $total {
              value = $total + $row_sum
            }
          }
        }
      
        var $entry {
          value = {
            tech_id          : $tech.id
            first_name       : ($tech.first_name ?? "")
            last_name        : ($tech.last_name ?? "")
            phone            : ($tech.phone ?? "")
            email            : ($tech.email ?? "")
            row_count        : $earn_rows.items|count
            total_paid       : $total
            box_1_nonemp_comp: $total
          }
        }
      
        var.update $out {
          value = $out|push:$entry
        }
      }
    }
  }

  response = {success: true, tax_year: $year, techs: $out}
  guid = "generate-1099-summary-v1"
}