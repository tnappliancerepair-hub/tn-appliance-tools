// Records a new referral attribution. Used at intake when a customer
// arrives via ?ref=TNA-XXXXXX URL parameter. Writes an event_log row
// that get_referral_code later counts.
query record_referral verb=POST {
  api_group = "intake"

  input {
    int referred_job_id
    text referral_code
    int? referred_customer_id?
  }

  stack {
    var $code_clean {
      value = ($input.referral_code ?? "")|trim|upper
    }
  
    precondition ($code_clean != "") {
      error_type = "inputerror"
      error = "referral_code is required"
    }
  
    var $meta_obj {
      value = {
        referred_job_id     : $input.referred_job_id
        referred_customer_id: ($input.referred_customer_id ?? 0)
        referral_code       : $code_clean
        recorded_at_ms      : now|to_ms
      }
    }
  
    var $meta_json {
      value = $meta_obj|json_encode
    }
  
    var $action_key {
      value = "referral_credited_" ~ $code_clean
    }
  
    db.add event_log {
      data = {action: $action_key, metadata: $meta_json}
    } as $row
  }

  response = {
    success      : true
    referral_code: $code_clean
    event_log_id : $row.id
  }

  guid = "record-referral-v1"
}