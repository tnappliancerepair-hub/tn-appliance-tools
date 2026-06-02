// Batch lookup — returns the latest warranty_submissions row per job in
// a CSV of job_ids. Lets warranty-review.html paint status badges across
// the queue in one round trip instead of N.
query list_warranty_submissions_for_jobs verb=POST {
  api_group = "intake"

  input {
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
                db.query warranty_submissions {
                  where = $db.warranty_submissions.job_id == $jid
                  sort = {warranty_submissions.created_at: "desc"}
                  return = {type: "list", paging: {page: 1, per_page: 1}}
                } as $rows

                var $sub { value = (($rows.items|first) ?? null) }

                conditional {
                  if ($sub != null) {
                    var.update $out {
                      value = $out|push:{
                        job_id          : $jid
                        submission_id   : ($sub.id ?? 0)
                        status          : ($sub.status ?? "pending")
                        vendor          : ($sub.vendor ?? "")
                        confirmation_id : ($sub.confirmation_id ?? "")
                        submitted_by    : ($sub.submitted_by ?? "")
                        paid_amount     : ($sub.paid_amount ?? 0)
                        last_attempt_at : ($sub.last_attempt_at ?? null)
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

  response = {
    success     : true
    submissions : $out
    count       : ($out|count)
  }

  guid = "list-warranty-submissions-for-jobs-v1"
}
