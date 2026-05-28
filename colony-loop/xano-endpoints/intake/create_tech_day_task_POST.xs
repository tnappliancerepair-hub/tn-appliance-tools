// Create a non-customer schedule block for a tech — lunch, parts pickup,
// internal training, "HAS ANNA NO 3-6", etc. Distinct from tech_availability
// which is for day-offs. These show up on tech-daily-dashboard alongside
// real jobs so the tech sees their full day.
query create_tech_day_task verb=POST {
  api_group = "intake"

  input {
    int   technician_id
    text  task_date          // YYYY-MM-DD
    text  title              // "Lunch", "HAS ANNA NO 3-6", "Pickup parts at Marcone", etc.
    text? start_time?        // HH:MM 24h
    text? end_time?          // HH:MM 24h
    text? notes?
    text? created_by?
  }

  stack {
    var $tid { value = ($input.technician_id ?? 0) }
    var $td  { value = (($input.task_date ?? "")|trim) }
    var $title_clean { value = (($input.title ?? "")|trim) }

    precondition ($tid > 0 && $td != "" && $title_clean != "") {
      error_type = "inputerror"
      error      = "technician_id, task_date, title required"
    }

    db.add tech_day_task {
      data = {
        technician_id : $tid
        task_date     : $td
        title         : $title_clean
        start_time    : (($input.start_time ?? "")|trim)
        end_time      : (($input.end_time ?? "")|trim)
        notes         : (($input.notes ?? "")|trim)
        created_by    : (($input.created_by ?? "office")|trim)
      }
    } as $task
  }

  response = {
    success: true
    id     : $task.id
    technician_id: $tid
    task_date    : $td
    title        : $title_clean
  }

  guid = "create-tech-day-task-v1"
}
