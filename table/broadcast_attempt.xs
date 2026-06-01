// One row per broadcast or proposal. Tracks who was notified, who claimed, expiry, escalation.
// Atomic claim handler: UPDATE ... SET claimed_by_tech_id=X WHERE id=Y AND status='open'. First wins.
table broadcast_attempt {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // The job being broadcast or proposed.
    int? job_id? {
      table = "jobs"
    }
  
    // open_schedule_first_reply = flexible customer, first qualified tech wins.
    // must_time_proposal = rigid customer, propose specific time/tech.
    enum broadcast_type {
      values = ["open_schedule_first_reply", "must_time_proposal"]
    }
  
    // When the broadcast/proposal SMS fired.
    timestamp broadcast_at?
  
    // 30-minute escalation deadline. Null if no auto-escalate (e.g., for must_time_proposal awaiting tech reply).
    timestamp? expires_at?
  
    // JSON array of tech_ids that received the broadcast.
    json techs_notified?
  
    // First tech to claim. Null while still open.
    int? claimed_by_tech_id? {
      table = "technicians"
    }
  
    // When the winning claim landed.
    timestamp? claimed_at?
  
    // When the broadcast was bumped to Teddy after no claims by expires_at.
    timestamp? escalated_to_owner_at?
  
    // open = waiting for claims. claimed = a tech grabbed it. expired = no claims by deadline. escalated = handed to owner. canceled = manually killed.
    enum status?=open {
      values = ["open", "claimed", "expired", "escalated", "canceled"]
    }
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "job_id"}]}
    {type: "btree", field: [{name: "status"}]}
    {type: "btree", field: [{name: "expires_at"}]}
  ]

  guid = "t4gS2WpI-LMYm6thgwZh1A0dJEo"
}