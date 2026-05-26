// Inserts a single scheduling_queue row with action_type=propose for the
// given job. The existing scheduling_queue_worker.xs propose handler picks
// it up on its next cycle and SMSes the owner three top-scored slot options.
// Audit-logs the enqueue to event_log.
query enqueue_scheduling_queue_propose verb=POST {
  api_group = "intake"

  input {
    int job_id
    text? source?
  }

  stack {
    precondition ($input.job_id != null && $input.job_id > 0) {
      error_type = "inputerror"
      error      = "job_id is required"
    }

    db.get jobs {
      field_name  = "id"
      field_value = $input.job_id
    } as $job

    precondition ($job != null) {
      error_type = "notfound"
      error      = "Job not found"
    }

    var $source_str {
      value = (($input.source ?? "")|trim)
    }

    db.add scheduling_queue {
      data = {
        job_id     : $input.job_id
        action_type: "propose"
        status     : "pending"
      }
    } as $row

    db.add event_log {
      data = {
        action  : "scheduling_queue_propose_enqueued"
        metadata: {
          job_id           : $input.job_id
          scheduling_queue_id: $row.id
          source           : $source_str
          warranty_company : ($job.warranty_company ?? "")
          parts_status     : ($job.parts_status ?? "")
        }
      }
    } as $log
  }

  response = {
    success            : true
    scheduling_queue_id: $row.id
    job_id             : $input.job_id
  }

  guid = "enqueue-scheduling-queue-propose-v1"
}
