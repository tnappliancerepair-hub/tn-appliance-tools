// Returns email_generic_warranty jobs that still have the placeholder
// customer ("(Pending review)") — those are the ones that need Claude
// extraction. Limit kept low so parse-warranty-drafts can stay under
// Netlify's 10s sync timeout (Claude call ~2s per job).
query list_unparsed_warranty_drafts verb=GET {
  api_group = "intake"

  input {
    int? limit?
  }

  stack {
    var $lim {
      value = ($input.limit ?? 4)
    }

    db.query jobs {
      where = $db.jobs.intake_source == "email_generic_warranty" && $db.jobs.scheduling_status == "needs_more_info"
      sort = {jobs.id: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $job_rows

    var $items {
      value = []
    }

    var $picked {
      value = 0
    }

    foreach ($job_rows.items) {
      each as $j {
        conditional {
          if ($picked < $lim) {
            db.get customer {
              field_name = "id"
              field_value = ($j.customer_id ?? 0)
            } as $cust

            var $needs_parse {
              value = ((($cust.first_name|to_text) ?? "")|trim) == "(Pending review)"
            }

            conditional {
              if ($needs_parse) {
                var $row {
                  value = {
                    job_id        : $j.id
                    customer_id   : ($j.customer_id ?? 0)
                    warranty_company: (($j.warranty_company|to_text) ?? "")
                    notes_internal: (($j.notes_internal|to_text) ?? "")
                    problem_summary: (($j.problem_summary|to_text) ?? "")
                  }
                }
                var.update $items {
                  value = $items|push:$row
                }
                var.update $picked {
                  value = $picked + 1
                }
              }
            }
          }
        }
      }
    }
  }

  response = {
    success: true
    count  : $items|count
    items  : $items
  }

  guid = "list-unparsed-warranty-drafts-v1"
}
