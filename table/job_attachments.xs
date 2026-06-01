// Table to store metadata about photos and videos uploaded to AWS S3 for each appliance repair job.
table job_attachments {
  auth = false

  schema {
    // Unique identifier for the attachment (primary key)
    int id
  
    // Timestamp when the record was created
    timestamp created_at?=now
  
    // Reference to the associated job
    // Reference to the jobs table.
    // Nullable because chat-captured uploads may exist before a job is created;
    // they are linked to a real job_id by create_job_from_chat at submit time.
    int? job_id? {
      table = "jobs"
    }
  
    // For uploads captured during chat intake before a job exists.
    // Linked to a real job_id via create_job_from_chat after the customer submits.
    int? conversation_id? {
      table = "agent_conversation"
    }
  
    // The category of the attachment based on the stage of the job
    enum attachment_type?=intake {
      values = ["intake", "completion", "tdr"]
    }
  
    // The type of file (photo or video)
    enum file_type {
      values = ["photo", "video"]
    }
  
    // The S3 object key/path for the file (max 500 characters)
    text s3_key filters=max:500
  
    // The original filename from the uploader's device
    text original_filename? filters=max:255
  
    // File size in bytes for storage tracking
    int file_size_bytes?
  
    // The MIME type of the file (e.g., image/jpeg)
    text mime_type? filters=max:100
  
    // Identifies who uploaded the file
    enum uploaded_by {
      values = ["customer", "tech", "teddy"]
    }
  
    // References the technicians table when uploaded_by is "tech"
    // Reference to technicians table for tech uploads
    int uploaded_by_user_id? {
      table = "technicians"
    }
  
    // Optional notes or caption about the file
    text caption? filters=max:500
  
    // When the file was first viewed by a technician in HCP
    timestamp viewed_by_tech_at?
  
    // When the file was synced to Housecall Pro
    timestamp pushed_to_hcp_at?
  
    // The resulting Housecall Pro attachment ID after sync
    text hcp_attachment_id? filters=max:255
  
    timestamp? upload_complete_at?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "job_id"}]}
    {type: "btree", field: [{name: "conversation_id"}]}
    {type: "btree", field: [{name: "uploaded_by_user_id"}]}
    {
      type : "btree"
      field: [{name: "job_id"}, {name: "attachment_type"}]
    }
  ]

  guid = "itcTNnFg3oiM49fxcalmZMWb3hc"
}