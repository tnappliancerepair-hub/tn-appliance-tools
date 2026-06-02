// SquareTrade payment / remittance intake. Minimum-viable: persists
// the parsed payment data to event_log so it's recoverable, returns
// 200 so the Gmail poller doesn't 404-loop. Future enhancement: parse
// the lines, match against open warranty_submissions rows, update
// status='paid' + paid_amount when matches are confident.
//
// Same shape as ahs_payment_intake — they share the parser-symmetry
// convention so a future consolidation can merge them.
query squaretrade_payment_intake verb=POST {
  api_group = "intake"

  input {
    text? gmail_message_id?
    text? gmail_thread_id?
    text? sender?
    text? subject?
    text? payload_json?
    int? received_at_ms?
  }

  stack {
    var $msg_id_clean { value = (($input.gmail_message_id ?? "")|trim) }
    var $subject_clean { value = (($input.subject ?? "")|trim) }
    var $payload_clean { value = ($input.payload_json ?? "") }

    // Idempotency check — same gmail_message_id won't double-process
    var $existing_count { value = 0 }
    conditional {
      if ($msg_id_clean != "") {
        var $marker { value = "\"gmail_message_id\":\"" ~ $msg_id_clean ~ "\"" }

        db.query event_log {
          where = $db.event_log.action == "squaretrade_payment_received"
          sort = {event_log.created_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 50}}
        } as $existing_rows

        foreach ($existing_rows.items) {
          each as $r {
            var $meta_str { value = ($r.metadata|json_encode) }
            var $stripped { value = $meta_str|replace:$marker:"" }
            var $len_a { value = $meta_str|strlen }
            var $len_b { value = $stripped|strlen }
            conditional {
              if ($len_b < $len_a) {
                var.update $existing_count { value = $existing_count + 1 }
              }
            }
          }
        }
      }
    }

    var $is_duplicate { value = ($existing_count > 0) }
    var $new_id { value = 0 }

    conditional {
      if ($is_duplicate == false) {
        db.add event_log {
          data = {
            action    : "squaretrade_payment_received"
            metadata  : {
              gmail_message_id : $msg_id_clean
              gmail_thread_id  : (($input.gmail_thread_id ?? "")|trim)
              sender           : (($input.sender ?? "")|trim)
              subject          : $subject_clean
              payload_json     : $payload_clean
              received_at_ms   : ($input.received_at_ms ?? 0)
              source           : "servicepower_gmail_poller"
            }
          }
        } as $audit
        var.update $new_id { value = $audit.id }
      }
    }
  }

  response = {
    success        : true
    duplicate      : $is_duplicate
    event_log_id   : $new_id
    gmail_message_id : $msg_id_clean
    note           : "Persisted to event_log. Line-item parsing + warranty_submissions match pending."
  }

  guid = "squaretrade-payment-intake-v1"
}
