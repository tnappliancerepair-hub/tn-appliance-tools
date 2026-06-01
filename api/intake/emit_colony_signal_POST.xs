query emit_colony_signal verb=POST {
  api_group = "intake"

  input {
    text signal_type
    int signal_strength?
    text source_colony?
    text target_colonies?
    text payload?
  }

  stack {
    var $strength {
      value = ($input.signal_strength ?? 50)
    }
  
    var $source {
      value = ($input.source_colony ?? "")
    }
  
    var $targets {
      value = ($input.target_colonies ?? "")
    }
  
    var $payload_str {
      value = ($input.payload ?? "")
    }
  
    db.add colony_signals {
      data = {
        signal_type    : $input.signal_type
        signal_strength: $strength
        source_colony  : $source
        target_colonies: $targets
        payload        : $payload_str
      }
    } as $new_signal
  
    db.add event_log {
      data = {
        action  : "colony_signal_emitted"
        metadata: {
        signal_id      : $new_signal.id
        signal_type    : $input.signal_type
        signal_strength: $strength
        source_colony  : $source
      }
      }
    } as $log_row
  }

  response = {success: true, signal_id: $new_signal.id}
  guid = "emit-colony-signal-v1"
}