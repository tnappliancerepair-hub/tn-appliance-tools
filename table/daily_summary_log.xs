// Audit log for daily tech summary SMS sends. Composite (tech_id, sent_for_date)
// dedupes the cron — if a row exists, the summary for that tech+date is already done.
table daily_summary_log {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // The tech this summary was sent to.
    int? tech_id? {
      table = "technicians"
    }
  
    // Calendar date (Central Time) the summary covers. Composite-indexed with tech_id.
    date? sent_for_date?
  
    // Wall-clock time the SMS was actually fired.
    timestamp? sent_at?
  
    // Number of jobs in the summary (0 = "nothing on the books today" message).
    int? job_count?
  
    // Whether Twilio accepted the request (HTTP 2xx). False rows act as a "tried but failed"
    // marker; for now we still write the row so the dedupe holds and we don't spam retries.
    bool? sms_success?
  
    // Twilio MessageSid for traceability.
    text? twilio_sid?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {
      type : "btree"
      field: [{name: "tech_id"}, {name: "sent_for_date"}]
    }
  ]

  guid = "Dly5UmrygTkpBz9XKqWvCmL3PXY"
}