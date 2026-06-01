// Returns completed jobs older than N days that are candidates for
// cold-storage archival. v1 just lists; future ops can add a flag
// column + dedicated archive table.
query list_archivable_jobs verb=GET {
  api_group = "intake"

  input {
    int? days_old?
    int? limit?
  }

  stack {
    var $days {
      value = ($input.days_old ?? 90)
    }
  
    var $lim {
      value = ($input.limit ?? 100)
    }
  
    var $cutoff_ms {
      value = (now|to_ms) - ($days * 24 * 60 * 60 * 1000)
    }
  
    var $cutoff_ts {
      value = ($cutoff_ms / 1000)|to_timestamp
    }
  
    db.query jobs {
      where = $db.jobs.scheduling_status == "completed" && $db.jobs.job_completed_at != null && $db.jobs.job_completed_at < $cutoff_ts
      sort = {jobs.job_completed_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: $lim}}
    } as $rows
  
    db.query jobs {
      where = $db.jobs.scheduling_status == "completed" && $db.jobs.job_completed_at != null && $db.jobs.job_completed_at < $cutoff_ts
      return = {type: "count"}
    } as $total
  }

  response = {
    success    : true
    days_old   : $days
    total_count: ($total ?? 0)
    shown      : $rows.items|count
    jobs       : $rows.items
  }

  guid = "list-archivable-jobs-v1"
}