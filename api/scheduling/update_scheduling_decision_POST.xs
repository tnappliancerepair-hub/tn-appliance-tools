//  Single explicit write path for setting or changing a TDR's scheduling_decision.
//  Drives the Ant Tech Scheduler pipeline: history audit → TDR update → jobs
//  denormalization → scheduling_queue insertion.
// 
//  Decision-to-status / action mapping:
//    ready_to_schedule (open_schedule)  → status=ready,         action=broadcast
//    ready_to_schedule (must_time)      → status=ready,         action=propose
//    awaiting_parts                     → status=awaiting_parts, action=wait
//    customer_constraint                → status=ready,         action=propose
//    second_visit_needed                → status=ready,         action=broadcast
//    not_scheduling                     → status=canceled,      action=(skip queue)
//    hold_for_customer                  → status=held,          action=notify
// 
//  changed_by falls back to tdr.technician_id when input is omitted.
//  No-op short-circuit if new_decision == previous_decision.
query update_scheduling_decision verb=POST {
  api_group = "scheduling"

  input {
    int tdr_id
    text new_decision filters=trim
    int? changed_by?
    text? scheduling_constraint? filters=trim
    text? notes? filters=trim
  }

  stack {
    // ────────────────────────────────────────────────────────
    // 1. Validate new_decision is one of the 6 enum values.
    // ────────────────────────────────────────────────────────
    conditional {
      if ($input.new_decision != "ready_to_schedule" && $input.new_decision != "awaiting_parts" && $input.new_decision != "customer_constraint" && $input.new_decision != "second_visit_needed" && $input.new_decision != "not_scheduling" && $input.new_decision != "hold_for_customer") {
        return {
          value = {
            error       : "invalid scheduling_decision value"
            received    : $input.new_decision
            valid_values: ["ready_to_schedule", "awaiting_parts", "customer_constraint", "second_visit_needed", "not_scheduling", "hold_for_customer"]
          }
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 2. Fetch TDR. 404-equivalent if not found.
    // ────────────────────────────────────────────────────────
    db.get technician_decision_report {
      field_name = "id"
      field_value = $input.tdr_id
    } as $tdr
  
    conditional {
      if ($tdr == null) {
        return {
          value = {error: "tdr not found", tdr_id: $input.tdr_id}
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 3. Capture previous decision + resolve changed_by fallback.
    // ────────────────────────────────────────────────────────
    var $previous_decision {
      value = $tdr.scheduling_decision
    }
  
    var $changed_by_resolved {
      value = $input.changed_by ?? $tdr.technician_id
    }
  
    // ────────────────────────────────────────────────────────
    // 4. No-op short-circuit if decision unchanged.
    // ────────────────────────────────────────────────────────
    conditional {
      if ($input.new_decision == $previous_decision) {
        return {
          value = {
            no_op           : true
            message         : "decision unchanged"
            tdr_id          : $input.tdr_id
            current_decision: $previous_decision
          }
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 5. Insert scheduling_decision_history audit row.
    // ────────────────────────────────────────────────────────
    db.add scheduling_decision_history {
      data = {
        tdr_id           : $input.tdr_id
        job_id           : $tdr.job_id
        previous_decision: $previous_decision
        new_decision     : $input.new_decision
        changed_by       : $changed_by_resolved
        changed_at       : now
        notes            : $input.notes
      }
    } as $history_row
  
    // ────────────────────────────────────────────────────────
    // 6. Update TDR fields.
    // ────────────────────────────────────────────────────────
    db.edit technician_decision_report {
      field_name = "id"
      field_value = $input.tdr_id
      data = {
        scheduling_decision           : $input.new_decision
        scheduling_decision_updated_at: now
        scheduling_decision_updated_by: $changed_by_resolved
        scheduling_constraint         : $input.scheduling_constraint
      }
    } as $updated_tdr
  
    // ────────────────────────────────────────────────────────
    // 7. Fetch job (need scheduling_type to disambiguate broadcast vs propose).
    // ────────────────────────────────────────────────────────
    db.get jobs {
      field_name = "id"
      field_value = $tdr.job_id
    } as $job
  
    // ────────────────────────────────────────────────────────
    // 8. Compute new scheduling_status + action_type.
    //    Empty action_type means "skip queue insertion".
    // ────────────────────────────────────────────────────────
    var $new_status {
      value = ""
    }
  
    var $action_type {
      value = ""
    }
  
    conditional {
      if ($input.new_decision == "ready_to_schedule") {
        var.update $new_status {
          value = "ready"
        }
      
        var.update $action_type {
          value = ($job.scheduling_type == "must_time") ? "propose" : "broadcast"
        }
      }
    
      else {
        conditional {
          if ($input.new_decision == "awaiting_parts") {
            var.update $new_status {
              value = "awaiting_parts"
            }
          
            var.update $action_type {
              value = "wait"
            }
          }
        
          else {
            conditional {
              if ($input.new_decision == "customer_constraint") {
                var.update $new_status {
                  value = "ready"
                }
              
                var.update $action_type {
                  value = "propose"
                }
              }
            
              else {
                conditional {
                  if ($input.new_decision == "second_visit_needed") {
                    var.update $new_status {
                      value = "ready"
                    }
                  
                    var.update $action_type {
                      value = "broadcast"
                    }
                  }
                
                  else {
                    conditional {
                      if ($input.new_decision == "not_scheduling") {
                        var.update $new_status {
                          value = "canceled"
                        }
                      
                        // action_type stays empty → skip queue
                      }
                    
                      else {
                        conditional {
                          if ($input.new_decision == "hold_for_customer") {
                            var.update $new_status {
                              value = "held"
                            }
                          
                            var.update $action_type {
                              value = "notify"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 9. Update jobs denormalization.
    // ────────────────────────────────────────────────────────
    db.edit jobs {
      field_name = "id"
      field_value = $tdr.job_id
      data = {
        current_scheduling_decision: $input.new_decision
        scheduling_status          : $new_status
      }
    } as $updated_job
  
    // ────────────────────────────────────────────────────────
    // 10. Insert scheduling_queue row (skip when action_type is empty,
    //     i.e., not_scheduling).
    // ────────────────────────────────────────────────────────
    var $queue_row {
      value = null
    }
  
    conditional {
      if ($action_type != "") {
        db.add scheduling_queue {
          data = {
            job_id     : $tdr.job_id
            action_type: $action_type
            status     : "pending"
          }
        } as $new_queue_row
      
        var.update $queue_row {
          value = $new_queue_row
        }
      }
    }
  
    // ────────────────────────────────────────────────────────
    // 11. Return result summary.
    // ────────────────────────────────────────────────────────
    return {
      value = {
        tdr_id           : $input.tdr_id
        job_id           : $tdr.job_id
        previous_decision: $previous_decision
        new_decision     : $input.new_decision
        new_status       : $new_status
        action_type      : $action_type
        changed_by       : $changed_by_resolved
        history_row      : $history_row
        queue_row        : $queue_row
      }
    }
  }

  response = null
  guid = "UpdSchDec_v1_pH7tNqRkBzL3"
}