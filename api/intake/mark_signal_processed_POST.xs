query mark_signal_processed verb=POST {
  api_group = "intake"

  input {
    int signal_id
    text result_action?
    text result_json?
  }

  stack {
    db.edit colony_signals {
      field_name = "id"
      field_value = $input.signal_id
      data = {processed_at: now}
    } as $updated
  
    var $action_clean {
      value = (($input.result_action ?? "")|trim)
    }
  
    conditional {
      if ($action_clean != "") {
        var $raw_json {
          value = ($input.result_json ?? "{}")
        }
      
        var $result_obj {
          value = $raw_json|json_decode
        }
      
        db.add event_log {
          data = {action: $action_clean, metadata: $result_obj}
        } as $log_row
      }
    }
  }

  response = {success: true, signal_id: $input.signal_id}
  guid = "mark-signal-processed-v1"
}