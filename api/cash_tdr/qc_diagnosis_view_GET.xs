//  Returns the customer-facing TDR view payload for the cash flow QC pipeline.
//  Validates the signed token via Netlify gateway, checks TDR.confirmed_at
//  for consumption, then returns header + N failures + per-failure pricing
//  for cash-tdr-customer.html to render.
// 
//  Phase 1c step 3a: real HMAC validation via Netlify (XanoScript has no
//  native HMAC primitive). Demo block still hardcoded; Phase 1c step 3b
//  will replace it with real db.get against TDR + tdr_failure rows.
query qc_diagnosis_view verb=GET {
  api_group = "cash_tdr"

  input {
    text token?
  }

  stack {
    conditional {
      if ($input.token == null || $input.token == "") {
        return {
          value = {success: false, error: "token required"}
        }
      }
    }
  
    // Validate token via Netlify gateway (HMAC + expiry).
    // HARDCODED 2026-05-06: $env.NETLIFY_VALIDATE_QC_TOKEN_URL was set on Xano but
    // not being read by api.request (came through empty, returned URL malformed error).
    // Hardcoded to unblock Phase 1c step 3a. Future cleanup: debug Xano env var
    // access pattern. URL is stable (Netlify site name doesn't change).
    api.request {
      url = "https://superlative-naiad-233aa7.netlify.app/.netlify/functions/validate-qc-token"
      method = "POST"
      params = {token: $input.token}
      headers = [
        "Content-Type: application/json"
        "X-Internal-Auth: " ~ $env.HCP_INTERNAL_AUTH_SECRET
      ]
    
    } as $validation
  
    var $val {
      value = ($validation.response.result ?? {})
    }
  
    conditional {
      if ($val.valid != true) {
        var $user_msg {
          value = ($val.reason == "expired") ? "This link has expired. Please call us at 866-268-0111 to get a new one." : "Invalid link. Please call us at 866-268-0111."
        }
      
        return {
          value = {
            success: false
            error  : $user_msg
            reason : ($val.reason ?? "invalid")
          }
        }
      }
    }
  
    // Token signature + expiry are valid. Check TDR consumption.
    db.get technician_decision_report {
      field_name = "id"
      field_value = $val.tdr_id
    } as $tdr
  
    conditional {
      if ($tdr == null) {
        return {
          value = {
            success: false
            error  : "Diagnosis not found. Please call us at 866-268-0111."
          }
        }
      }
    }
  
    conditional {
      if ($tdr.confirmed_at != null) {
        return {
          value = {
            success: false
            error  : "This Quick Check has already been completed. Please call us at 866-268-0111 if you need help."
            reason : "consumed"
          }
        }
      }
    }
  
    // === Phase 1c step 3c (2026-05-06): real data, no more demo ===
  
    // Load job for customer relationships + appliance display fields.
    db.get jobs {
      field_name = "id"
      field_value = $tdr.job_id
    } as $job
  
    conditional {
      if ($job == null) {
        return {
          value = {
            success: false
            error  : "Job not found. Please call us at 866-268-0111."
            reason : "job_not_found"
          }
        }
      }
    }
  
    // Resolve bill_to customer (multi-party support, fallback to primary customer).
    // bill_to_customer_id defaults to 0 on quick-check jobs, and `0 ?? customer_id`
    // keeps 0 -> wrong/empty customer (greeted "there"). Use it only when it's real.
    var $bill_to_id {
      value = ((($job.bill_to_customer_id ?? 0) > 0) ? ($job.bill_to_customer_id) : ($job.customer_id))
    }

    db.get customer {
      field_name = "id"
      field_value = $bill_to_id
    } as $bill_to

    // Out-of-area (outside TN/LA) -> the customer TDR drops the install options and
    // shows ship-only. In-area zips: TN 37/38, LA 70/71. Empty zip -> treat in-area
    // (show all, the prior default) so we never hide install on a missing zip.
    var $oa_zip2 {
      value = ((($bill_to.zip ?? "")|to_text)|substr:0:2)
    }
    var $oa_in_area {
      value = ($oa_zip2 == "37" || $oa_zip2 == "38" || $oa_zip2 == "70" || $oa_zip2 == "71")
    }
    var $out_of_area {
      value = ($oa_zip2 != "" && $oa_in_area == false)
    }
  
    // Compose appliance display string from brand + appliance_type.
    var $appliance_str {
      value = (($job.brand ?? "") ~ " " ~ ($job.appliance_type ?? ""))|trim
    }
  
    // Load all tdr_failure rows for this TDR.
    db.query tdr_failure {
      where = $db.tdr_failure.tdr_id == $tdr.id
      return = {type: "list"}
    } as $failure_rows
  
    // Constant labor credit (frontend applies once across multi-failure totals).
    var $credit {
      value = ($tdr.labor_credit_cents ?? 5000)
    }
  
    // Build failures array via foreach + var.update + |push.
    // Phase 1c step 3e (2026-05-06): customer-facing part prices = our_cost × 1.30.
    // The $50 Quick Check Credit is NOT baked into per-card pricing — applied
    // at order level during the running-total computation in the frontend AND
    // in Stripe line items (qc_create_checkout_session). Per-card display
    // would confuse customers who pick mixed DIY+install options.
    var $failures_mapped {
      value = []
    }
  
    foreach ($failure_rows) {
      each as $f {
        var $oem_cost {
          value = ($f.oem_part_our_cost_cents ?? 0)
        }
      
        var $amz_cost {
          value = ($f.amazon_part_our_cost_cents ?? 0)
        }
      
        var $labor {
          value = ($f.labor_customer_cost_cents ?? 0)
        }
      
        var $oem_customer {
          value = ($oem_cost * 13 / 10)|to_int
        }
      
        var $amz_customer {
          value = ($amz_cost * 13 / 10)|to_int
        }
      
        var.update $failures_mapped {
          value = $failures_mapped
            |push:```
              {
                id: ($f.id|to_text)
                failure_description: $f.failure_description
                tenant_reported: ($f.tenant_reported ?? false)
                selected_option: ($f.selected_option ?? "pending")
                pricing: {
                  diy_oem: {part: $oem_customer, shipping: 0, total: $oem_customer}
                  diy_amazon: {part: $amz_customer, shipping: 0, total: $amz_customer}
                  install_oem: {labor: $labor, part: $oem_customer, credit: 0, total: ($oem_customer + $labor)}
                  install_amazon: {labor: $labor, part: $amz_customer, credit: 0, total: ($amz_customer + $labor)}
                }
              }
              ```
        }
      }
    }
  
    var $resp {
      value = {
        success           : true
        token_mode        : "validated"
        customer          : {
          first_name: ($bill_to.first_name ?? "there")
          appliance: ($appliance_str != "" ? $appliance_str : "Appliance")
          model: ($job.model_number ?? "")
          out_of_area: $out_of_area
        }
        is_rental         : ($job.is_rental ?? false)
        diagnosis         : ($tdr.customer_facing_diagnosis ?? "")
        failures          : $failures_mapped
        labor_credit_cents: $credit
        expires_at        : $tdr.expires_at
      }
    }
  }

  response = $resp
  guid = "b7rigCqZIeA6dJmu16fqbvw-mto"
}