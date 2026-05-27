// Returns discount eligibility flags for a customer at intake time.
// Today: senior (age >= 65 from dob), first_responder (manual tag),
// loyalty (3+ completed jobs).
//
// Schema note: customer table needs date_of_birth + is_first_responder
// columns to fully populate these. Until added, those flags return false.
query get_customer_discount_eligibility verb=GET {
  api_group = "intake"

  input {
    int customer_id
  }

  stack {
    db.get customer {
      field_name  = "id"
      field_value = $input.customer_id
    } as $customer

    precondition ($customer != null) {
      error_type = "notfound"
      error      = "Customer not found"
    }

    // Loyalty: count of completed jobs ever
    db.query jobs {
      where  = $db.jobs.customer_id == $customer.id && $db.jobs.scheduling_status == "completed"
      return = {type: "count"}
    } as $completed_count

    var $loyalty_tier {
      value = (($completed_count ?? 0) >= 5 ? "gold" : (($completed_count ?? 0) >= 3 ? "silver" : "none"))
    }

    // Senior: dob field may not exist; safe lookup with ??
    var $dob_str {
      value = (($customer.date_of_birth ?? "") ?? "")|to_text|trim
    }

    var $senior_eligible {
      value = false
    }

    conditional {
      if ($dob_str != "" && ($dob_str|strlen) >= 4) {
        var $birth_year {
          value = ($dob_str|substr:0:4)|to_int
        }

        var $now_year {
          value = (now|format_timestamp:"Y")|to_int
        }

        var $age_approx {
          value = $now_year - $birth_year
        }

        conditional {
          if ($age_approx >= 65) {
            var.update $senior_eligible {
              value = true
            }
          }
        }
      }
    }

    // First-responder: manual tag (column may not exist yet)
    var $first_responder {
      value = (($customer.is_first_responder ?? false) ?? false)
    }

    // Computed discount percentage
    var $discount_pct {
      value = ($senior_eligible == true ? 10 : ($first_responder == true ? 10 : ($loyalty_tier == "gold" ? 5 : 0)))
    }
  }

  response = {
    success         : true
    customer_id     : $customer.id
    completed_count : ($completed_count ?? 0)
    loyalty_tier    : $loyalty_tier
    senior_eligible : $senior_eligible
    first_responder : $first_responder
    discount_pct    : $discount_pct
  }

  guid = "get-customer-discount-eligibility-v1"
}
