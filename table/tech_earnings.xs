// Per-job earnings ledger for technicians. Captures labor commission, addon commission, parts markup. Status transitions pending_payment -> paid via payout batch.
table tech_earnings {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }
  
    // FK to technicians.id
    int? tech_id?
  
    // FK to jobs.id
    int? job_id?
  
    // warranty or self_pay
    text? job_type?
  
    // Labor revenue for the job
    decimal? labor_amount?
  
    // Tech commission rate applied (e.g., 0.40)
    decimal? commission_rate?
  
    // labor_amount * commission_rate
    decimal? commission_earned?
  
    // Sum of tech_split from any addons sold
    decimal? addon_commission?
  
    // Markup share on parts sold to customer
    decimal? parts_markup?
  
    // commission_earned + addon_commission + parts_markup
    decimal? total_earned?
  
    // pending_payment or paid
    text? status?
  
    // Job completion timestamp
    timestamp? earned_at?
  
    // When the payout was issued
    timestamp? paid_at?
  
    // Batch date this earning was paid in
    date? payout_batch_date?
  
    int company_id?=1
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "created_at", op: "desc"}]}
    {type: "btree", field: [{name: "tech_id", op: "asc"}]}
    {type: "btree", field: [{name: "status", op: "asc"}]}
    {type: "btree", field: [{name: "earned_at", op: "desc"}]}
  ]

  guid = "KZiM1dbO4-sydjhNf8NUKxY5yE0"
}