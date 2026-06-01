// Stores conversation threads for agents/chatbots.
table agent_conversation {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // The user who owns this conversation thread.
    int owner_user? {
      table = "user"
    }
  
    // The title or subject of the conversation.
    text title? filters=trim
  
    // Timestamp of the last message in the conversation.
    timestamp last_message_at?
  
    // Reference to the customer associated with this conversation.
    int customer_id? {
      table = "customer"
    }
  
    // Reference to the technician associated with this conversation.
    // Used for tech-SMS conversations driven by Ant Tech Scheduler.
    // Mutually exclusive with customer_id in practice (one or the other, not both).
    int? tech_id? {
      table = "technicians"
    }
  
    // The communication channel (e.g., 'web', 'sms', 'voice') for this conversation.
    text channel? filters=trim
  
    // Unique identifier for the conversation session.
    text? session_id? filters=trim
  
    // Links this conversation to a Tech Ant Assist live in-field session.
    // Null for non-assist conversations (customer Ant, tech scheduler, etc).
    int? assist_session_id? {
      table = "tech_assist_session"
    }
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "session_id"}]}
    {type: "btree", field: [{name: "tech_id"}]}
  ]

  tags = ["xano:quick-start"]
  guid = "U0VM6yD9sDB_UdtVvXiYaYdz_TM"
}