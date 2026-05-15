// One row per warranty-company remittance event. A "batch" is whatever
// the warranty company calls a single settlement payment — typically an
// EFT advice with N claim lines underneath. The header data lives here;
// the individual claim lines live in warranty_payment_lines (FK back to
// this table).
//
// Idempotency: gmail_message_id UNIQUE when not null. Parser checks here
// FIRST before doing any work — duplicate Gmail-message fires no-op
// cleanly. Manual entries (210 paper checks) have gmail_message_id=null
// and rely on a UI-side check_number duplicate check.
//
// status lifecycle:
//   parsed       — parser ran, lines created, matching attempted
//   reconciled   — all lines matched OR disputed/resolved
//   approved     — included in an approved tech_payroll_period (locked)
//
// Created 2026-05-15 as part of the financial system build.
table warranty_payment_batches {
  auth = false

  schema {
    int id
    timestamp created_at?=now {
      visibility = "private"
    }

    // FK → warranty_vendor_accounts.id. Tells us company, state,
    // active-flag for this batch.
    int? vendor_account_id? {
      table = "warranty_vendor_accounts"
    }

    // EFT settlement date or check date.
    timestamp? payment_date?

    // Pay period the remittance covers (from header line like
    // "Period Ending: 5/12/26").
    timestamp? period_ending?

    // Trace/advice number from the remittance header.
    text? eft_reference? filters=trim
    text? advice_number? filters=trim

    // Header-stated total. Compared against sum of net_amount across
    // payment lines — mismatch indicates a parse error OR disputed lines
    // the company already netted out.
    decimal? total_amount?=0

    // Gmail's stable message ID — the idempotency anchor. NULL for
    // manual entries.
    text? gmail_message_id? filters=trim
    text? gmail_thread_id? filters=trim

    // 'parsed' | 'reconciled' | 'approved'.
    text? status?=parsed filters=trim

    timestamp? parsed_at?=now
    timestamp? approved_at?

    // Running counts of line-matching outcomes for this batch. Kept
    // here (rather than computed via JOIN) so the dashboard payment-
    // inbox query stays single-table-fast.
    int? unmatched_count?=0
    int? matched_count?=0
    int? disputed_count?=0

    // The raw email body / paper check entry source text — kept for
    // audit so we can re-parse if format changes. Stripped when batch
    // is approved and 90 days old (Phase 6 cleanup task).
    text? raw_text?
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree", field: [{name: "vendor_account_id"}, {name: "payment_date", op: "desc"}]}
    {type: "btree", field: [{name: "status"}]}
    {type: "btree", field: [{name: "gmail_message_id"}], unique: true}
  ]
}
