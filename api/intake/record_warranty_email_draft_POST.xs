// Captures inbound warranty-dispatch emails from senders the AHS/SP
// pollers don't handle (NSA, SquareTrade variants, Allstate-via-ST).
// Creates a draft job in NEEDS REVIEW status with the raw email body in
// notes_internal — Danielle reviews + edits instead of typing each
// dispatch into HCP from scratch.
//
// Idempotent on gmail_message_id (audit log scan prevents duplicates).
// Identifies vendor from sender domain so warranty_company gets set.
query record_warranty_email_draft verb=POST {
  api_group = "intake"

  input {
    text sender
    text subject
    text body
    text gmail_message_id
    text? received_at_iso?
  }

  stack {
    precondition ($input.gmail_message_id != "" && $input.subject != "") {
      error_type = "inputerror"
      error      = "gmail_message_id and subject required"
    }

    // Dedup — has this message_id been recorded already?
    db.query event_log {
      where = $db.event_log.action == "warranty_email_draft_captured"
      sort = {event_log.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $recent

    var $already_captured {
      value = false
    }

    foreach ($recent.items) {
      each as $row {
        conditional {
          if (! $already_captured) {
            var $meta_str {
              value = (($row.metadata ?? "")|to_text)
            }
            conditional {
              if ($meta_str|contains:$input.gmail_message_id) {
                var.update $already_captured { value = true }
              }
            }
          }
        }
      }
    }

    conditional {
      if ($already_captured) {
        return {
          value = {
            success         : true
            skipped         : true
            reason          : "already_captured"
            gmail_message_id: $input.gmail_message_id
          }
        }
      }
    }

    // Identify vendor from sender domain
    var $sender_lower {
      value = (($input.sender ?? "")|to_text)
    }

    var $warranty_company {
      value = "Unknown"
    }

    conditional {
      if ($sender_lower|contains:"nationalservicealliance") {
        var.update $warranty_company { value = "NSA" }
      }
      elseif ($sender_lower|contains:"squaretrade") {
        var.update $warranty_company { value = "SquareTrade" }
      }
      elseif ($sender_lower|contains:"frontdoor") {
        var.update $warranty_company { value = "AHS" }
      }
      elseif ($sender_lower|contains:"servicepower") {
        var.update $warranty_company { value = "ServicePower" }
      }
      elseif ($sender_lower|contains:"allstate") {
        var.update $warranty_company { value = "Allstate" }
      }
    }

    // Stash full email in notes_internal so Danielle has everything
    var $notes_block {
      value = "[Auto-captured from email]\n\nFrom: " ~ ($input.sender ?? "") ~ "\nSubject: " ~ ($input.subject ?? "") ~ "\nReceived: " ~ ($input.received_at_iso ?? "") ~ "\n\n---\n\n" ~ ($input.body ?? "")
    }

    // Create draft customer (placeholder — Danielle fills name/phone on review)
    // All optional address fields set to empty string so downstream
    // queue endpoints don't trip on null reads.
    db.add customer {
      data = {
        first_name: "(Pending review)"
        last_name : ""
        phone     : ""
        email     : ""
        address   : ""
        city      : ""
        state     : ""
        zip       : ""
        company_id: 1
      }
    } as $new_customer

    db.add jobs {
      data = {
        customer_id        : $new_customer.id
        intake_source      : "email_generic_warranty"
        customer_type      : "warranty"
        warranty_company   : $warranty_company
        scheduling_status  : "needs_more_info"
        friendly_status    : "Email captured — needs review"
        notes_internal     : $notes_block
        problem_summary    : ($input.subject ?? "")
        parallel_mode      : true
        company_id         : 1
      }
    } as $new_job

    db.add event_log {
      data = {
        action  : "warranty_email_draft_captured"
        metadata: ```
          {
            gmail_message_id: $input.gmail_message_id
            sender          : ($input.sender ?? "")
            warranty_company: $warranty_company
            job_id          : $new_job.id
            customer_id     : $new_customer.id
          }|json_encode
          ```
      }
    }
  }

  response = {
    success         : true
    job_id          : $new_job.id
    customer_id     : $new_customer.id
    warranty_company: $warranty_company
  }

  guid = "record-warranty-email-draft-v1"
}
