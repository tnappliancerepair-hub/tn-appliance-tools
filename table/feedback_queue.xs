// Queue for delayed feedback SMS sending.
table feedback_queue {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // Reference to the job for which feedback should be sent.
    int job_id {
      table = "jobs"
    }
  
    // The phone number to send the feedback SMS to.
    text customer_phone filters=trim
  
    // The first name of the customer to include in the SMS.
    text customer_first_name filters=trim
  
    // The timestamp when the feedback SMS should be sent.
    timestamp send_at
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "send_at", op: "asc"}]}
  ]

  guid = "ZB-tRL82YGrqgIfCmWyXCAltzQg"
}