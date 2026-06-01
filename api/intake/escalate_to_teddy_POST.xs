// Generic structured-escalation: fires a context-rich SMS to Teddy
// (615-485-5795) with up to 3 reply options A/B/C and STOP. Captures
// the choices in event_log so the inbound SMS handler can match the
// reply back to this offer.
//
// This is the autopilot precursor pattern: instead of "Danielle handles X,"
// system condenses the situation into one structured question + 2-3
// pre-formed answers. Teddy taps a letter from his phone in seconds.
query escalate_to_teddy verb=POST {
  api_group = "intake"

  input {
    text section
    text question
    text? option_a?
    text? option_b?
    text? option_c?
    int? job_id?
    text? context_note?
  }

  stack {
    var $section_clean {
      value = (($input.section ?? "")|trim)
    }

    var $question_clean {
      value = (($input.question ?? "")|trim)
    }

    precondition ($section_clean != "") {
      error_type = "inputerror"
      error = "section required"
    }

    precondition ($question_clean != "") {
      error_type = "inputerror"
      error = "question required"
    }

    var $opt_a {
      value = (($input.option_a ?? "")|trim)
    }

    var $opt_b {
      value = (($input.option_b ?? "")|trim)
    }

    var $opt_c {
      value = (($input.option_c ?? "")|trim)
    }

    var $job_id_in {
      value = ($input.job_id ?? 0)
    }

    var $job_label {
      value = ""
    }

    conditional {
      if ($job_id_in > 0) {
        var.update $job_label {
          value = " (job #" ~ ($job_id_in|to_text) ~ ")"
        }
      }
    }

    var $a_line {
      value = ($opt_a != "") ? ("\nA = " ~ $opt_a) : ""
    }

    var $b_line {
      value = ($opt_b != "") ? ("\nB = " ~ $opt_b) : ""
    }

    var $c_line {
      value = ($opt_c != "") ? ("\nC = " ~ $opt_c) : ""
    }

    var $stop_line {
      value = "\nReply STOP to dismiss"
    }

    var $context_clean {
      value = (($input.context_note ?? "")|trim)
    }

    var $context_phrase {
      value = ($context_clean != "") ? ("\n" ~ $context_clean) : ""
    }

    var $sms_body {
      value = "[ant] " ~ $section_clean ~ $job_label ~ "\n" ~ $question_clean ~ $context_phrase ~ $a_line ~ $b_line ~ $c_line ~ $stop_line
    }

    api.request {
      url = "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/send_sms"
      method = "POST"
      params = {to: "+16154855795", message: $sms_body, context_tag: "escalate_to_teddy"}
      headers = ["Content-Type: application/json"]
      timeout = 30
    } as $teddy_sms

    db.add event_log {
      data = {
        action  : "escalation_to_teddy_sent"
        metadata: {
        section       : $section_clean
        question      : $question_clean
        option_a      : $opt_a
        option_b      : $opt_b
        option_c      : $opt_c
        job_id        : $job_id_in
        context_note  : $context_clean
        awaiting_reply: true
      }
      }
    } as $esc_audit
  }

  response = {
    success         : true
    escalation_id   : $esc_audit.id
    sms_sent        : true
    awaiting_reply  : true
    body_preview    : $sms_body
  }

  guid = "escalate-to-teddy-v1"
}
