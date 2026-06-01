// Returns a stable referral code for a customer. Uses zero-padded
// customer_id as the canonical code (e.g. "TNA-000116"). Idempotent —
// safe to call multiple times.
query get_referral_code verb=GET {
  api_group = "intake"

  input {
    int customer_id
  }

  stack {
    db.get customer {
      field_name = "id"
      field_value = $input.customer_id
    } as $customer
  
    precondition ($customer != null) {
      error_type = "notfound"
      error = "Customer not found"
    }
  
    var $id_str {
      value = $customer.id|to_text
    }
  
    var $id_len {
      value = $id_str|strlen
    }
  
    var $pad_count {
      value = ($id_len >= 6 ? 0 : (6 - $id_len))
    }
  
    var $padded {
      value = ($pad_count > 0 ? (("000000"|substr:0:$pad_count) ~ $id_str) : $id_str)
    }
  
    var $code {
      value = "TNA-" ~ $padded
    }
  
    // Count referrals via compound action key
    var $action_key {
      value = "referral_credited_" ~ $code
    }
  
    db.query event_log {
      where = $db.event_log.action == $action_key
      return = {type: "count"}
    } as $referral_count
  }

  response = {
    success       : true
    customer_id   : $customer.id
    referral_code : $code
    first_name    : ($customer.first_name ?? "")
    referral_count: ($referral_count ?? 0)
    share_url     : "https://tnapplianceexchange.net/?ref=" ~ $code
  }

  guid = "get-referral-code-v1"
}