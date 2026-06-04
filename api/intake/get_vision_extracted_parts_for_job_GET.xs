// Surface all vision-extracted parts (used + returned) for one job.
// Powers the warranty-review.html parts sections + the warranty
// auto-draft. Returns two arrays: parts_used + parts_returned.
query get_vision_extracted_parts_for_job verb=GET {
  api_group = "intake"

  input {
    int job_id
  }

  stack {
    db.query job_attachments {
      where = $db.job_attachments.job_id == $input.job_id && $db.job_attachments.vision_status == "classified"
      sort = {job_attachments.created_at: "desc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $rows

    var $atts { value = ($rows.items ?? []) }
  }

  response = {
    success     : true
    job_id      : $input.job_id
    attachments : $atts
    count       : ($atts|length)
  }

  guid = "get-vision-extracted-parts-for-job-v1"
}
