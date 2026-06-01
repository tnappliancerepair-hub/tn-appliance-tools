//  Closes a payout batch: marks all pending_payment tech_earnings rows as paid,
//  stamps payout_batch_date = today, sends per-tech SMS + a summary SMS to
//  Teddy. dry_run=true returns calculated amounts without writing or sending.
// 
//  Called manually by Teddy from the office dashboard (or via Postman) on
//  payout day (3rd / 18th cadence). Billy (tech 5) gets a "PayPal" copy;
//  everyone else gets "Zelle".
query payout_batch verb=POST {
  api_group = "intake"

  input {
    bool? dry_run?
  }

  stack {
    var $is_dry_run {
      value = ($input.dry_run ?? false)
    }
  
    // 1. Pull all pending_payment rows.
    db.query tech_earnings {
      where = $db.tech_earnings.status == "pending_payment"
      return = {type: "list", paging: {page: 1, per_page: 5000}}
    } as $pending_list
  
    // Today's date (CT).
    var $today_ct_ts {
      value = now|transform_timestamp:"-5 hours"
    }
  
    var $today_date_str {
      value = $today_ct_ts|format_timestamp:"Y-m-d"
    }
  
    // 2. Load tech roster for name + phone lookup.
    db.query technicians {
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $tech_roster
  
    // 3. Group by tech: outer loop = tech, inner = pending rows.
    // XanoScript has no dynamic-key map ops, so this O(n*m) walk is the
    // cleanest approach. Roster ~6 techs, pending ~tens to hundreds, fine.
    var $payouts {
      value = []
    }
  
    var $grand_total {
      value = 0
    }
  
    foreach ($tech_roster.items) {
      each as $tech {
        var $tech_sum {
          value = 0
        }
      
        var $tech_row_ids {
          value = []
        }
      
        foreach ($pending_list.items) {
          each as $e {
            conditional {
              if ($e.tech_id == $tech.id) {
                var.update $tech_sum {
                  value = $tech_sum + ($e.commission_earned ?? 0)
                }
              
                array.push $tech_row_ids {
                  value = $e.id
                }
              }
            }
          }
        }
      
        conditional {
          if ($tech_sum > 0) {
            // 4. Real run: mark each row paid + send tech SMS.
            conditional {
              if ($is_dry_run == false) {
                foreach ($tech_row_ids) {
                  each as $row_id {
                    db.edit tech_earnings {
                      field_name = "id"
                      field_value = $row_id
                      data = {
                        status           : "paid"
                        paid_at          : now
                        payout_batch_date: $today_date_str
                      }
                    } as $updated
                  }
                }
              
                // Tech SMS (Billy gets PayPal note, others get Zelle).
                var $payment_method {
                  value = ($tech.id == 5) ? "PayPal" : "Zelle"
                }
              
                var $sum_str {
                  value = $tech_sum|to_text
                }
              
                var $tech_sms_body {
                  value = "your payout of $" ~ $sum_str ~ " is being processed. " ~ $payment_method ~ " incoming."
                }
              
                var $tech_phone_bare {
                  value = (($tech.phone ?? "")|trim)
                }
              
                conditional {
                  if ($tech_phone_bare != "") {
                    api.request {
                      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
                      method = "POST"
                      params = {to: "+1" ~ $tech_phone_bare, message: $tech_sms_body}
                      headers = ["Content-Type: application/json"]
                      timeout = 30
                    } as $tech_sms_resp
                  }
                }
              }
            }
          
            // 5. Append to summary (dry_run or real).
            array.push $payouts {
              value = {
                tech_id  : $tech.id
                tech_name: (($tech.first_name ?? "")|trim)
                amount   : $tech_sum
                row_count: $tech_row_ids|count
              }
            }
          
            var.update $grand_total {
              value = $grand_total + $tech_sum
            }
          }
        }
      }
    }
  
    // 6. Teddy summary SMS (skip on dry_run).
    conditional {
      if ($is_dry_run == false) {
        var $teddy_body_parts {
          value = ""
        }
      
        foreach ($payouts) {
          each as $p {
            var.update $teddy_body_parts {
              value = $teddy_body_parts ~ $p.tech_name ~ " $" ~ ($p.amount|to_text) ~ ", "
            }
          }
        }
      
        var $teddy_body {
          value = "[ant] payout batch - " ~ $teddy_body_parts ~ "Total $" ~ ($grand_total|to_text)
        }
      
        var $teddy_phone {
          value = (($env.OWNER_PHONE_NUMBER ?? "")|trim)
        }
      
        conditional {
          if ($teddy_phone != "") {
            api.request {
              url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
              method = "POST"
              params = {to: $teddy_phone, message: $teddy_body}
              headers = ["Content-Type: application/json"]
              timeout = 30
            } as $teddy_sms_resp
          }
        }
      }
    }
  
    // 7. Audit log (always — dry_run included so we can review what would happen).
    db.add event_log {
      data = {
        action  : "payout_batch_processed"
        metadata: {
        dry_run    : $is_dry_run
        payouts    : $payouts
        grand_total: $grand_total
        batch_date : $today_date_str
      }
      }
    } as $audit_log
  }

  response = {
    success   : true
    dry_run   : $is_dry_run
    payouts   : $payouts
    total     : $grand_total
    batch_date: $today_date_str
  }

  guid = "1ewTvY0uPVlRzBjo2ctISTUl_tk"
}