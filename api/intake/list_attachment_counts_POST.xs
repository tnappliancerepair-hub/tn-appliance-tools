// Batch attachment-count lookup. Takes a CSV of job_ids, returns a
// list of {job_id, count} so the office-today / warranty-review pages
// can render a 📎 N media badge without N round trips. Counts only
// upload-complete attachments (in-flight uploads are not visible to
// Danielle and shouldn't inflate the badge).
query list_attachment_counts verb=POST {
  api_group = "intake"

  input {
    // comma-separated job ids, e.g. "18526,18534,18537"
    text job_ids_csv
  }

  stack {
    var $raw    { value = (($input.job_ids_csv ?? "")|trim) }
    var $tokens { value = $raw|split:"," }
    var $out    { value = [] }

    foreach ($tokens) {
      each as $tok {
        var $jid_str { value = ($tok ?? "")|trim }
        conditional {
          if ($jid_str != "") {
            var $jid { value = $jid_str|to_int }
            conditional {
              if ($jid > 0) {
                db.query job_attachments {
                  where = $db.job_attachments.job_id == $jid && $db.job_attachments.upload_complete_at != null
                  return = {type: "list", paging: {page: 1, per_page: 200}}
                } as $rows
                var $c { value = ($rows.items|count) }
                var.update $out {
                  value = $out|push:{
                    job_id : $jid
                    count  : $c
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    success : true
    counts  : $out
  }

  guid = "list-attachment-counts-v1"
}
