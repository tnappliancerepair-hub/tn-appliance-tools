// Returns existing customer by exact phone match, or creates new one.
// Prevents duplicate customer records when same phone appears across
// multiple intake paths.
query find_or_merge_customer verb=POST {
  api_group = "intake"

  input {
    text phone
    text? first_name?
    text? last_name?
    text? email?
    text? address?
    text? city?
    text? state?
    text? zip?
  }

  stack {
    var $phone_clean {
      value = ($input.phone ?? "")|trim
    }

    precondition ($phone_clean != "") {
      error_type = "inputerror"
      error      = "phone is required"
    }

    var $digits {
      value = $phone_clean|replace:"+":""|replace:"-":""|replace:"(":""|replace:")":""|replace:" ":""|replace:".":""
    }

    var $digits_len {
      value = $digits|strlen
    }

    var $last10_start {
      value = ($digits_len - 10)
    }

    var $digits_last10 {
      value = ($digits_len >= 10 ? ($digits|substr:$last10_start) : $digits)
    }

    var $e164 {
      value = ("+1" ~ $digits_last10)
    }

    db.query customer {
      where  = $db.customer.phone == $digits || $db.customer.phone == $digits_last10 || $db.customer.phone == $e164 || $db.customer.phone == $phone_clean
      sort   = {customer.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $existing_rows

    var $existing {
      value = (($existing_rows.items|first) ?? null)
    }

    var $action_taken { value = "" }
    var $customer_id { value = 0 }

    conditional {
      if ($existing != null) {
        var.update $customer_id {
          value = $existing.id
        }
        var.update $action_taken {
          value = "matched_existing"
        }
      }

      else {
        db.add customer {
          data = {
            first_name : ($input.first_name ?? "")
            last_name  : ($input.last_name ?? "")
            phone      : $phone_clean
            email      : ($input.email ?? "")
            address    : ($input.address ?? "")
            city       : ($input.city ?? "")
            state      : ($input.state ?? "")
            zip        : ($input.zip ?? "")
          }
        } as $new_cust

        var.update $customer_id {
          value = $new_cust.id
        }
        var.update $action_taken {
          value = "created_new"
        }
      }
    }
  }

  response = {
    success      : true
    customer_id  : $customer_id
    action_taken : $action_taken
  }

  guid = "find-or-merge-customer-v1"
}
