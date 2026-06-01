//  Audit log of every vendor email landing in tnappliancerepair@gmail.com
//  + what the system did with it. One row per Gmail message (UNIQUE on
//  gmail_message_id for idempotency). Smart-dedup model per Phase A1
//  decisions: first email for a given Call # creates the parent job in
//  `jobs`; subsequent emails for the same Call # log here and may trigger
//  field updates on the parent (SCHEDULE_CHANGE, CANCELLATION, NOTES_ADDED).
// 
//  Created 2026-05-12 as part of Phase A1 schema delta.
// NOTE: gmail_message_id idempotency is enforced at the application
// level (servicepower_email_intake_POST.xs runs db.get on it before any
// mutation). The btree index below makes that lookup fast. UNIQUE
// constraint at the database level was attempted via CLI push but the
// type was rejected with "Invalid index type" — Teddy can promote to
// UNIQUE via Xano admin UI as defense-in-depth after the table exists.
table job_email_event {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // The parent jobs row this email refers to. NULL allowed because some
    // emails reference a Call # we can't resolve to an existing job
    // (logged-only path — captured for audit but no job touched).
    int? job_id? {
      table = "jobs"
    }
  
    // Operational meaning. One of (parser-enforced):
    //   DISPATCH_OFFER, DISPATCH_OFFER_ACCEPTED, SCHEDULE_CHANGE,
    //   CANCELLATION, ESTIMATE_APPROVED, ESTIMATE_PENDING_REVIEW,
    //   CIL_ACCEPTED, NOTES_ADDED, STATUS_REQUEST_REMINDER, RMA_AVAILABLE,
    //   PARTS_SHIPPED, COMPLETION_CONFIRMATION, FAILED_REPAIR,
    //   SECOND_VISIT_DISPATCH, DAILY_DIGEST, HUMAN_REPLY, UNKNOWN, STATUS_UPDATE
    text email_type? filters=trim
  
    // Which vendor sent the email. One of: ahs, servicepower, squaretrade,
    // nsa, frontdoor (free text — enforced via parser, not schema, so new
    // vendors don't require migrations).
    text vendor? filters=trim
  
    // Gmail's stable message ID. UNIQUE — same Gmail message can never be
    // processed twice. For multi-section emails where the body contains N
    // dispatches, the FIRST row uses the raw gmail_message_id and
    // subsequent rows use synthesized IDs of the form "{id}#{index}" to
    // satisfy this constraint while preserving traceability.
    text gmail_message_id? filters=trim
  
    // Gmail thread ID — useful for reply-chain grouping in the inbox.
    text gmail_thread_id? filters=trim
  
    // From: header value as received.
    text sender? filters=trim
  
    // Full subject line.
    text subject? filters=trim
  
    // First 500 chars of the email body, already redacted of PII by the
    // parser before the POST to Xano.
    text body_excerpt? filters=trim
  
    // What the system DID with this email. One of:
    //   logged_only, created_job, updated_job_status, closed_job_cil,
    //   appended_notes, flagged_for_review, duplicate_ignored,
    //   customer_dedup_failed, customer_dedup_partial_phone,
    //   customer_dedup_partial_address
    text triggered_action? filters=trim
  
    // Human-readable resolution note for cockpit + audit review.
    // Example: "Call # 098894074139 matched existing job 5421"
    //          "DISPATCH_OFFER created new job_id=5422 (dedup_status=OK)"
    //          "duplicate gmail_message_id; no-op"
    text resolution_note? filters=trim
  
    // Vendor-specific parsed fields that don't fit on the jobs table —
    // dispatch_index for multi-section emails, raw section header, parsed
    // attribute map, dedup_status, etc. Free-form JSON.
    json metadata?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "gmail_message_id"}]}
    {
      type : "btree"
      field: [{name: "job_id"}, {name: "created_at", op: "desc"}]
    }
    {
      type : "btree"
      field: [
        {name: "vendor"}
        {name: "email_type"}
        {name: "created_at", op: "desc"}
      ]
    }
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
  ]

  guid = "1OgvnfcXTEX_zGsUS1Rn_FbjkWY"
}