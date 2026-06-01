// Classifies event_log action strings into INFO / WARN / ERROR.
// Uses string-equality checks on common suffix/prefix patterns instead
// of substring search (XS find filter returns truthy on not-found).
query classify_event_severity verb=GET {
  api_group = "intake"

  input {
    text action
  }

  stack {
    var $a {
      value = ($input.action ?? "")|trim|lower
    }
  
    // Suffix tests via replace: if string changes after replace, suffix exists
    var $sev {
      value = "info"
    }
  
    // Test for error/failure suffixes via replace + length comparison
    var $a_no_error {
      value = $a|replace:"error":""
    }
  
    var $has_error {
      value = ($a|strlen) != ($a_no_error|strlen)
    }
  
    var $a_no_failed {
      value = $a|replace:"failed":""
    }
  
    var $has_failed {
      value = ($a|strlen) != ($a_no_failed|strlen)
    }
  
    var $a_no_blocked {
      value = $a|replace:"blocked":""
    }
  
    var $has_blocked {
      value = ($a|strlen) != ($a_no_blocked|strlen)
    }
  
    var $a_no_crash {
      value = $a|replace:"crash":""
    }
  
    var $has_crash {
      value = ($a|strlen) != ($a_no_crash|strlen)
    }
  
    var $a_no_alert {
      value = $a|replace:"alert":""
    }
  
    var $has_alert {
      value = ($a|strlen) != ($a_no_alert|strlen)
    }
  
    var $a_no_low {
      value = $a|replace:"low_rating":""
    }
  
    var $has_low {
      value = ($a|strlen) != ($a_no_low|strlen)
    }
  
    var $a_no_callback {
      value = $a|replace:"callback":""
    }
  
    var $has_callback {
      value = ($a|strlen) != ($a_no_callback|strlen)
    }
  
    var $a_no_ooa {
      value = $a|replace:"out_of_area":""
    }
  
    var $has_ooa {
      value = ($a|strlen) != ($a_no_ooa|strlen)
    }
  
    var $a_no_denial {
      value = $a|replace:"denial":""
    }
  
    var $has_denial {
      value = ($a|strlen) != ($a_no_denial|strlen)
    }
  
    conditional {
      if ($has_error || $has_failed || $has_blocked || $has_crash) {
        var.update $sev {
          value = "error"
        }
      }
    
      elseif ($has_alert || $has_low || $has_callback || $has_ooa || $has_denial) {
        var.update $sev {
          value = "warn"
        }
      }
    }
  }

  response = {success: true, action: $a, severity: $sev}
  guid = "classify-event-severity-v1"
}