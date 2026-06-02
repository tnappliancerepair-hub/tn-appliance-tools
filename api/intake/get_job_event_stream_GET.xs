// Universal per-job event stream. Powers the unified-workspace polling
// pattern: every per-job page calls this every ~30s, compares latest_event_id
// to its last seen value, fires DOM events if there's something new.
//
// Returns:
//   - current_state: minimal "what's the job right now" slice — status,
//     tech_id, scheduled_start, latest TDR, latest warranty_submission,
//     attachment count, customer phone (for any-role rendering)
//   - events: chronological event_log rows for this job (any action that
//     mentions this job_id in metadata) — for live timeline rendering
//   - latest_event_id: monotonic change-detection token; client compares
//     to last-seen to know if state changed
//
// Optional `since_id` input: only return events created AFTER that id, so
// polling can do delta-style fetches instead of refetching the whole stream.
query get_job_event_stream verb=GET {
  api_group = "intake"

  input {
    int job_id
    int? since_id?
  }

  stack {
    var $marker  { value = "\"job_id\":" ~ ($input.job_id|to_text) }
    var $since   { value = ($input.since_id ?? 0) }

    // Current job + customer + tech + latest TDR + latest warranty submission
    db.get jobs {
      field_name = "id"
      field_value = $input.job_id
    } as $job

    var $customer { value = null }
    var $tech     { value = null }

    conditional {
      if ($job != null && ($job.customer_id ?? 0) > 0) {
        db.get customer {
          field_name = "id"
          field_value = $job.customer_id
        } as $cust
        var.update $customer { value = $cust }
      }
    }

    conditional {
      if ($job != null && ($job.technician_id ?? 0) > 0) {
        db.get technicians {
          field_name = "id"
          field_value = $job.technician_id
        } as $t
        var.update $tech { value = $t }
      }
    }

    db.query technician_decision_report {
      where = $db.technician_decision_report.job_id == $input.job_id
      sort = {technician_decision_report.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $tdr_rows
    var $latest_tdr { value = (($tdr_rows.items|first) ?? null) }

    db.query warranty_submissions {
      where = $db.warranty_submissions.job_id == $input.job_id
      sort = {warranty_submissions.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $sub_rows
    var $latest_submission { value = (($sub_rows.items|first) ?? null) }

    db.query job_attachments {
      where = $db.job_attachments.job_id == $input.job_id && $db.job_attachments.upload_complete_at != null
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $att_rows
    var $attachment_count { value = ($att_rows.items|count) }

    // Pull recent event_log rows; client-side filter by metadata contains job_id.
    // The since_id filter lets the polling client only ask for new rows.
    db.query event_log {
      where = $db.event_log.id > $since
      sort = {event_log.id: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 300}}
    } as $event_rows

    var $events { value = [] }
    var $latest_event_id { value = $since }

    foreach ($event_rows.items) {
      each as $r {
        var $meta_str { value = ($r.metadata|json_encode) }
        var $stripped { value = $meta_str|replace:$marker:"" }
        var $len_a    { value = $meta_str|strlen }
        var $len_b    { value = $stripped|strlen }
        conditional {
          if ($len_b < $len_a) {
            var.update $events {
              value = $events|push:{
                id        : $r.id
                action    : $r.action
                created_at: $r.created_at
                metadata  : $r.metadata
              }
            }
            conditional {
              if ($r.id > $latest_event_id) {
                var.update $latest_event_id { value = $r.id }
              }
            }
          }
        }
      }
    }
  }

  response = {
    success         : true
    job_id          : $input.job_id
    latest_event_id : $latest_event_id
    current_state   : {
      job                : $job
      customer           : $customer
      tech               : $tech
      latest_tdr         : $latest_tdr
      latest_submission  : $latest_submission
      attachment_count   : $attachment_count
    }
    events          : $events
    event_count     : ($events|count)
  }

  guid = "get-job-event-stream-v1"
}
