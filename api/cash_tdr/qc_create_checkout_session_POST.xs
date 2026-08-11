//  Creates a Stripe Checkout Session for the cash TDR pay flow, with
//  selected-option-aware pricing (Phase 1c step 3e 2026-05-06).
// 
//  Pricing rules (locked, see step 3e spec):
//    - Parts: 30% markup on Teddy's cost, applied at checkout.
//      customer = round(our_cost * 1.30) [implemented as our_cost * 13 / 10]
//    - Labor: customer-facing rate stored as labor_customer_cost_cents,
//      used as-is (no markup), aggregated across install_* failures.
//    - $50 Quick Check Credit: applied at order level by subtracting from
//      aggregated labor (max(0, labor - 5000)). NEVER stacks on parts.
//      If total_labor == 0, no credit shown.
//    - $15 shipping: flat line item per checkout (any non-skip selection).
//    - No Stripe coupon (qc_credit_50 retired this step — kept in Stripe
//      for potential rollback but not referenced from this endpoint).
// 
//  Per-line semantics:
//    diy_oem     → 1 part line:  oem_cost * 1.30
//    diy_amazon  → 1 part line:  amazon_cost * 1.30
//    install_oem → 1 part line + accumulate labor
//    install_amazon → 1 part line + accumulate labor
//    skip        → no line items
// 
//  XanoScript implementation note: each |set is a separate var.update
//  statement (chained |set with computed keys returned "Invalid expression"
//  in 3d.2 testing — see comment in earlier endpoint).
query qc_create_checkout_session verb=POST {
  api_group = "cash_tdr"

  input {
    int tdr_id
    text public_view_token
  }

  stack {
    db.get technician_decision_report {
      field_name = "id"
      field_value = $input.tdr_id
    } as $tdr
  
    conditional {
      if ($tdr == null) {
        return {
          value = {
            success: false
            error  : "TDR not found"
            reason : "tdr_not_found"
          }
        }
      }
    }
  
    conditional {
      if ($input.public_view_token == null || $input.public_view_token == "" || $tdr.public_view_token != $input.public_view_token) {
        return {
          value = {
            success: false
            error  : "Invalid token"
            reason : "token_mismatch"
          }
        }
      }
    }
  
    conditional {
      if ($tdr.sent_to_customer_at == null) {
        return {
          value = {
            success: false
            error  : "TDR not yet sent to customer"
            reason : "not_sent"
          }
        }
      }
    }
  
    db.get jobs {
      field_name = "id"
      field_value = $tdr.job_id
    } as $job
  
    conditional {
      if ($job == null) {
        return {
          value = {
            success: false
            error  : "Job not found"
            reason : "job_not_found"
          }
        }
      }
    }
  
    db.get customer {
      field_name = "id"
      field_value = $job.customer_id
    } as $customer
  
    db.query tdr_failure {
      where = $db.tdr_failure.tdr_id == $tdr.id
      return = {type: "list"}
    } as $failure_rows
  
    var $params {
      value = {}
    }
  
    var $idx {
      value = 0
    }
  
    var $total_labor_cents {
      value = 0
    }
  
    var $non_skip_count {
      value = 0
    }

    var $oem_ship_count {
      value = 0
    }

    var $any_pending {
      value = false
    }
  
    var $any_unknown {
      value = false
    }
  
    foreach ($failure_rows) {
      each as $f {
        var $opt {
          value = ($f.selected_option ?? "pending")
        }
      
        var $oem_cost {
          value = ($f.oem_part_our_cost_cents ?? 0)
        }
      
        var $amz_cost {
          value = ($f.amazon_part_our_cost_cents ?? 0)
        }
      
        var $labor_cost {
          value = ($f.labor_customer_cost_cents ?? 0)
        }
      
        var $oem_customer {
          value = ($oem_cost * 13 / 10)|to_int
        }
      
        var $amz_customer {
          value = ($amz_cost * 13 / 10)|to_int
        }
      
        var $desc {
          value = ($f.failure_description ?? "Repair")
        }
      
        var $idx_str {
          value = $idx|to_text
        }
      
        // Branch on selected_option. Each branch may add a part line item
        // and/or accumulate labor and/or do nothing (skip).
        conditional {
          if ($opt == "skip") {
            // No line items. Don't touch idx/total_labor.
            var.update $non_skip_count {
              value = $non_skip_count + 0
            }
          }
        }
      
        conditional {
          if ($opt == "diy_oem") {
            var $name {
              value = $desc ~ " (incl. sourcing & warranty)"
            }
          
            var $unit_str {
              value = $oem_customer|to_text
            }
          
            var $key_currency {
              value = "line_items[" ~ $idx_str ~ "][price_data][currency]"
            }
          
            var $key_name {
              value = "line_items[" ~ $idx_str ~ "][price_data][product_data][name]"
            }
          
            var $key_amount {
              value = "line_items[" ~ $idx_str ~ "][price_data][unit_amount]"
            }
          
            var $key_qty {
              value = "line_items[" ~ $idx_str ~ "][quantity]"
            }
          
            var.update $params {
              value = $params|set:$key_currency:"usd"
            }
          
            var.update $params {
              value = $params|set:$key_name:$name
            }
          
            var.update $params {
              value = $params|set:$key_amount:$unit_str
            }
          
            var.update $params {
              value = $params|set:$key_qty:"1"
            }
          
            var.update $idx {
              value = $idx + 1
            }
          
            var.update $non_skip_count {
              value = $non_skip_count + 1
            }

            var.update $oem_ship_count {
              value = $oem_ship_count + 1
            }
          }
        }

        conditional {
          if ($opt == "diy_amazon") {
            var $name {
              value = $desc ~ " (incl. sourcing & warranty)"
            }
          
            var $unit_str {
              value = $amz_customer|to_text
            }
          
            var $key_currency {
              value = "line_items[" ~ $idx_str ~ "][price_data][currency]"
            }
          
            var $key_name {
              value = "line_items[" ~ $idx_str ~ "][price_data][product_data][name]"
            }
          
            var $key_amount {
              value = "line_items[" ~ $idx_str ~ "][price_data][unit_amount]"
            }
          
            var $key_qty {
              value = "line_items[" ~ $idx_str ~ "][quantity]"
            }
          
            var.update $params {
              value = $params|set:$key_currency:"usd"
            }
          
            var.update $params {
              value = $params|set:$key_name:$name
            }
          
            var.update $params {
              value = $params|set:$key_amount:$unit_str
            }
          
            var.update $params {
              value = $params|set:$key_qty:"1"
            }
          
            var.update $idx {
              value = $idx + 1
            }
          
            var.update $non_skip_count {
              value = $non_skip_count + 1
            }
          }
        }
      
        conditional {
          if ($opt == "install_oem") {
            var $name {
              value = $desc ~ " — part (incl. sourcing & warranty)"
            }
          
            var $unit_str {
              value = $oem_customer|to_text
            }
          
            var $key_currency {
              value = "line_items[" ~ $idx_str ~ "][price_data][currency]"
            }
          
            var $key_name {
              value = "line_items[" ~ $idx_str ~ "][price_data][product_data][name]"
            }
          
            var $key_amount {
              value = "line_items[" ~ $idx_str ~ "][price_data][unit_amount]"
            }
          
            var $key_qty {
              value = "line_items[" ~ $idx_str ~ "][quantity]"
            }
          
            var.update $params {
              value = $params|set:$key_currency:"usd"
            }
          
            var.update $params {
              value = $params|set:$key_name:$name
            }
          
            var.update $params {
              value = $params|set:$key_amount:$unit_str
            }
          
            var.update $params {
              value = $params|set:$key_qty:"1"
            }
          
            var.update $idx {
              value = $idx + 1
            }
          
            var.update $total_labor_cents {
              value = $total_labor_cents + $labor_cost
            }
          
            var.update $non_skip_count {
              value = $non_skip_count + 1
            }
          }
        }
      
        conditional {
          if ($opt == "install_amazon") {
            var $name {
              value = $desc ~ " — part (incl. sourcing & warranty)"
            }
          
            var $unit_str {
              value = $amz_customer|to_text
            }
          
            var $key_currency {
              value = "line_items[" ~ $idx_str ~ "][price_data][currency]"
            }
          
            var $key_name {
              value = "line_items[" ~ $idx_str ~ "][price_data][product_data][name]"
            }
          
            var $key_amount {
              value = "line_items[" ~ $idx_str ~ "][price_data][unit_amount]"
            }
          
            var $key_qty {
              value = "line_items[" ~ $idx_str ~ "][quantity]"
            }
          
            var.update $params {
              value = $params|set:$key_currency:"usd"
            }
          
            var.update $params {
              value = $params|set:$key_name:$name
            }
          
            var.update $params {
              value = $params|set:$key_amount:$unit_str
            }
          
            var.update $params {
              value = $params|set:$key_qty:"1"
            }
          
            var.update $idx {
              value = $idx + 1
            }
          
            var.update $total_labor_cents {
              value = $total_labor_cents + $labor_cost
            }
          
            var.update $non_skip_count {
              value = $non_skip_count + 1
            }
          }
        }
      
        conditional {
          if ($opt == "pending") {
            var.update $any_pending {
              value = true
            }
          }
        }
      
        conditional {
          if ($opt != "skip" && $opt != "diy_oem" && $opt != "diy_amazon" && $opt != "install_oem" && $opt != "install_amazon" && $opt != "pending") {
            var.update $any_unknown {
              value = true
            }
          }
        }
      }
    }
  
    conditional {
      if ($any_pending) {
        return {
          value = {
            success: false
            error  : "All failures must have a selection persisted before checkout"
            reason : "selections_pending"
          }
        }
      }
    }
  
    conditional {
      if ($any_unknown) {
        return {
          value = {
            success: false
            error  : "Unknown selected_option on a failure"
            reason : "invalid_option"
          }
        }
      }
    }
  
    conditional {
      if ($non_skip_count <= 0) {
        return {
          value = {
            success: false
            error  : "Please select an option other than Skip for at least one repair item"
            reason : "all_skipped"
          }
        }
      }
    }
  
    // Aggregate labor line: only when at least one install_* selection.
    // Quick Check Credit: subtract $5000 from labor floor 0 (no overflow
    // into parts).
    conditional {
      if ($total_labor_cents > 0) {
        var $idx_str_l {
          value = $idx|to_text
        }
      
        // Quick Check Credit = what the customer actually paid (job stamp), TDR
        // override wins, legacy $50 default for pre-stamp TDRs. 0 when waived/free.
        var $qc_credit_cents {
          value = ($tdr.labor_credit_cents ?? ($job.quick_check_credit_cents ?? 5000))
        }

        var $adjusted_labor {
          value = ($total_labor_cents - $qc_credit_cents)
        }
      
        conditional {
          if ($adjusted_labor < 0) {
            var.update $adjusted_labor {
              value = 0
            }
          }
        }
      
        var $labor_str {
          value = $adjusted_labor|to_text
        }
      
        var $key_currency_l {
          value = "line_items[" ~ $idx_str_l ~ "][price_data][currency]"
        }
      
        var $key_name_l {
          value = "line_items[" ~ $idx_str_l ~ "][price_data][product_data][name]"
        }
      
        var $key_amount_l {
          value = "line_items[" ~ $idx_str_l ~ "][price_data][unit_amount]"
        }
      
        var $key_qty_l {
          value = "line_items[" ~ $idx_str_l ~ "][quantity]"
        }
      
        var.update $params {
          value = $params|set:$key_currency_l:"usd"
        }
      
        var.update $params {
          value = $params
            |set:$key_name_l:"Repair labor (Quick Check Credit applied)"
        }
      
        var.update $params {
          value = $params|set:$key_amount_l:$labor_str
        }
      
        var.update $params {
          value = $params|set:$key_qty_l:"1"
        }
      
        var.update $idx {
          value = $idx + 1
        }
      }
    }
  
    // Delivery line - $15 Marcone delivery, ONLY when the OEM part ships to the
    // customer (diy_oem). Amazon ships free (Prime); install parts ride with the tech.
    conditional {
      if ($oem_ship_count > 0) {
    var $idx_str_s {
      value = $idx|to_text
    }
  
    var $key_currency_s {
      value = "line_items[" ~ $idx_str_s ~ "][price_data][currency]"
    }
  
    var $key_name_s {
      value = "line_items[" ~ $idx_str_s ~ "][price_data][product_data][name]"
    }
  
    var $key_amount_s {
      value = "line_items[" ~ $idx_str_s ~ "][price_data][unit_amount]"
    }
  
    var $key_qty_s {
      value = "line_items[" ~ $idx_str_s ~ "][quantity]"
    }
  
    var.update $params {
      value = $params|set:$key_currency_s:"usd"
    }
  
    var.update $params {
      value = $params
        |set:$key_name_s:"Delivery"
    }
  
    var.update $params {
      value = $params|set:$key_amount_s:"1500"
    }
  
    var.update $params {
      value = $params|set:$key_qty_s:"1"
    }
      }
    }

    // Quick Check Credit on a DIY (part-only) order: there's no labor line to
    // absorb the $50, so the credit was being lost for DIYers. Apply it as a
    // session-level coupon so the $50 comes off the PART. Only when the order is
    // pure-DIY ($total_labor_cents == 0, i.e. all non-skip selections were diy_*)
    // AND the Quick Check wasn't waived (labor_credit_cents > 0). Install/mixed
    // orders keep the labor-line credit above (no double-credit).
    var $diy_credit_cents {
      value = ($tdr.labor_credit_cents ?? ($job.quick_check_credit_cents ?? 5000))
    }
    // Pick the coupon that matches what they paid: >= $50 -> qc_credit_50, else
    // qc_credit_25 (Ant's Gift / church / partner). Below $25 (test/free) -> no
    // coupon, so we never over-credit a DIY part.
    var $diy_coupon {
      value = (($diy_credit_cents >= 5000) ? "qc_credit_50" : "qc_credit_25")
    }
    conditional {
      if ($total_labor_cents == 0) {
        conditional {
          if ($diy_credit_cents >= 2500) {
            var.update $params {
              value = $params|set:"discounts[0][coupon]":$diy_coupon
            }
          }
        }
      }
    }

    // Session-level params.
    var $cancel_url {
      value = "https://tnapplianceexchange.net/cash-tdr-customer.html?token=" ~ $input.public_view_token
    }
  
    var $tdr_id_str {
      value = $tdr.id|to_text
    }
  
    var $job_id_str {
      value = $job.id|to_text
    }
  
    var $customer_id_str {
      value = $job.customer_id|to_text
    }
  
    var.update $params {
      value = $params|set:"mode":"payment"
    }
  
    var.update $params {
      value = $params
        |set:"success_url":"https://tnapplianceexchange.net/cash-tdr-thank-you.html?session_id={CHECKOUT_SESSION_ID}"
    }
  
    var.update $params {
      value = $params|set:"cancel_url":$cancel_url
    }
  
    var.update $params {
      value = $params
        |set:"metadata[tdr_id]":$tdr_id_str
    }
  
    var.update $params {
      value = $params
        |set:"metadata[job_id]":$job_id_str
    }
  
    var.update $params {
      value = $params
        |set:"metadata[customer_id]":$customer_id_str
    }
  
    var.update $params {
      value = $params
        |set:"payment_intent_data[metadata][tdr_id]":$tdr_id_str
    }
  
    var.update $params {
      value = $params
        |set:"payment_intent_data[metadata][job_id]":$job_id_str
    }
  
    conditional {
      if ($customer != null && $customer.email != null && $customer.email != "") {
        var.update $params {
          value = $params
            |set:"customer_email":$customer.email
        }
      }
    }
  
    api.request {
      url = "https://api.stripe.com/v1/checkout/sessions"
      method = "POST"
      params = $params
      headers = [
        "Authorization: Bearer " ~ $env.STRIPE_SECRET_KEY
        "Content-Type: application/x-www-form-urlencoded"
      ]
    
      timeout = 15
    } as $stripe_resp
  
    var $stripe_status {
      value = ($stripe_resp.response.status ?? 0)
    }
  
    var $stripe_body {
      value = ($stripe_resp.response.result ?? {})
    }
  
    conditional {
      if ($stripe_status != 200) {
        return {
          value = {
            success      : false
            error        : "Stripe rejected the request"
            reason       : "stripe_error"
            stripe_status: $stripe_status
            stripe_error : ($stripe_body.error.message ?? "(no message)")
            stripe_type  : ($stripe_body.error.type ?? null)
          }
        }
      }
    }
  
    db.edit technician_decision_report {
      field_name = "id"
      field_value = $tdr.id
      data = {
        stripe_checkout_session_id: $stripe_body.id
        stripe_session_created_at : now
      }
    } as $tdr_updated
  }

  response = {
    success          : true
    checkout_url     : $stripe_body.url
    session_id       : $stripe_body.id
    total_labor_cents: $total_labor_cents
    non_skip_count   : $non_skip_count
  }

  guid = "Rd41Xd03m0b_kD2TctPg7DOgtKs"
}