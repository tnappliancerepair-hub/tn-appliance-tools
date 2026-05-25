query check_sp_jobs verb=GET {
  api_group = "intake"

  input {
    int? limit?
  }

  stack {
    var $cap {
      value = ($input.limit ?? 20)
    }

    db.query jobs {
      where = $db.jobs.intake_source == "servicepower_email"
      sort = {jobs.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: $cap}}
    } as $rows

    var $with_start_count {
      value = 0
    }

    var $without_start_count {
      value = 0
    }

    foreach ($rows.items) {
      each as $j {
        conditional {
          if (($j.scheduled_start ?? 0) > 0) {
            var.update $with_start_count {
              value = $with_start_count + 1
            }
          }

          else {
            var.update $without_start_count {
              value = $without_start_count + 1
            }
          }
        }
      }
    }
  }

  response = {
    success            : true
    total_returned     : ($rows.items|count)
    with_scheduled_start: $with_start_count
    without_scheduled_start: $without_start_count
    sample             : $rows.items
  }

  guid = "check-sp-jobs-v1"
}
