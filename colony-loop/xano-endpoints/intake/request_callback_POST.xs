// Books a callback promise from the phone brain. Writes an audit
// event_log row + emits a CALLBACK_PROMISED signal. A downstream
// callback_promised.js agent SMSes the target human (Teddy / Danielle /
// tech) with reason + when + customer contact info.
query request_callback verb=POST {
  api_group = "intake"

  input {
    int customer_id
    text? phone?
    text callback_for filters=trim   // teddy | danielle | tech | dispatch
    text reason filters=trim
    text? when_ct?
    text? priority?
    text? source?
  }

  stack {
    precondition ($input.customer_id > 0 && $input.callback_for != "" && $input.reason != "") {
      error_type = "inputerror"
      error      = "customer_id + callback_for + reason required"
    }

    var $meta {
      value = {
        customer_id  : $input.customer_id
        phone        : ($input.phone ?? "")
        callback_for : $input.callback_for
        reason       : $input.reason
        when_ct      : ($input.when_ct ?? "asap")
        priority     : ($input.priority ?? "normal")
        source       : ($input.source ?? "phone_brain")
        recorded_at  : now|to_ms
      }
    }

    db.add event_log {
      data = {
        action  : "callback_promised"
        metadata: $meta|json_encode
      }
    } as $audit

    db.add colony_signals {
      data = {
        signal_type    : "CALLBACK_PROMISED"
        signal_strength: ($input.priority == "urgent") ? 80 : 50
        source_colony  : "phone"
        target_colonies: ""
        payload        : $meta|json_encode
      }
    } as $signal
  }

  response = {
    success      : true
    event_log_id : $audit.id
    signal_id    : $signal.id
  }

  guid = "request-callback-v1"
}
