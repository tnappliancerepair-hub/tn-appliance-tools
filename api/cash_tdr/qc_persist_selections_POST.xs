//  Persist customer's per-failure option selections to tdr_failure rows
//  before checkout (Phase 1c step 3e 2026-05-06). Called by
//  cash-tdr-customer.html on Confirm and Pay BEFORE qc_create_checkout_session
//  reads the selections to compute line items.
// 
//  Auth via public_view_token exact match (same pattern as
//  qc_create_checkout_session). Hardens to HMAC validation in 3d.5+.
query qc_persist_selections verb=POST {
  api_group = "cash_tdr"

  input {
    int tdr_id
    text public_view_token
    json selections
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
            ok    : false
            error : "TDR not found"
            reason: "tdr_not_found"
          }
        }
      }
    }
  
    conditional {
      if ($input.public_view_token == null || $input.public_view_token == "" || $tdr.public_view_token != $input.public_view_token) {
        return {
          value = {
            ok    : false
            error : "Invalid token"
            reason: "token_mismatch"
          }
        }
      }
    }
  
    conditional {
      if ($tdr.confirmed_at != null) {
        return {
          value = {
            ok    : false
            error : "TDR already paid; selections frozen"
            reason: "already_paid"
          }
        }
      }
    }
  
    // Validate every selection up front (reject whole request on any
    // invalid option — atomic semantics). Using explicit OR comparison
    // because |contains: filter behavior with dynamic arg was unreliable
    // in testing.
    var $any_invalid {
      value = false
    }
  
    foreach ($input.selections) {
      each as $sel {
        var $opt {
          value = ($sel.selected_option ?? "")
        }
      
        conditional {
          if ($opt != "diy_oem" && $opt != "diy_amazon" && $opt != "install_oem" && $opt != "install_amazon" && $opt != "skip") {
            var.update $any_invalid {
              value = true
            }
          }
        }
      }
    }
  
    conditional {
      if ($any_invalid) {
        return {
          value = {
            ok    : false
            error : "Invalid selected_option in payload"
            reason: "invalid_option"
          }
        }
      }
    }
  
    // Apply selections. Skip + log any failure_id that doesn't belong to
    // this TDR (defensive — protects against cross-TDR tampering).
    var $persisted_count {
      value = 0
    }
  
    var $skipped_count {
      value = 0
    }
  
    foreach ($input.selections) {
      each as $sel {
        db.get tdr_failure {
          field_name = "id"
          field_value = $sel.failure_id
        } as $f
      
        conditional {
          if ($f != null && $f.tdr_id == $tdr.id) {
            db.edit tdr_failure {
              field_name = "id"
              field_value = $f.id
              data = {selected_option: $sel.selected_option, selected_at: now}
            } as $f_updated
          
            var.update $persisted_count {
              value = $persisted_count + 1
            }
          }
        }
      
        conditional {
          if ($f == null || $f.tdr_id != $tdr.id) {
            db.add event_log {
              data = {
                action  : "qc_persist_selections_failure_mismatch"
                metadata: {
                tdr_id         : $tdr.id
                bad_failure_id : $sel.failure_id
                selected_option: $sel.selected_option
              }
              }
            } as $mismatch_log
          
            var.update $skipped_count {
              value = $skipped_count + 1
            }
          }
        }
      }
    }
  }

  response = {
    ok             : true
    persisted_count: $persisted_count
    skipped_count  : $skipped_count
  }

  guid = "qdYeiZL547HY0kypIaLD1o98EdM"
}