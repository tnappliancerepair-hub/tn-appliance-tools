# ServicePower intake schema delta — 2026-05-12

> Schema changes required for Phase A1 (ServicePower email intake + dedup). Apply via Xano admin UI before running the parser end-to-end. **Read-only document** — does not modify schema directly; this is the spec Teddy executes.

Three changes: **1 new table, 4 new columns, 1 index verification**.

---

## Change 1 — NEW TABLE: `job_email_event`

Audit log of every vendor email that lands in the inbox + what the system did with it. One row per Gmail message (UNIQUE on `gmail_message_id` for idempotency).

### Fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int | yes (PK) | auto | Primary key |
| `created_at` | timestamp | yes | `now` | Set `visibility = private` per existing convention |
| `job_id` | int | no | — | FK → `jobs.id`. **Nullable** because some emails reference Call # that we can't resolve to an existing job (logged-only path). |
| `email_type` | text | yes | — | Enum-like value. See "Allowed email_type values" below. |
| `vendor` | text | yes | — | One of: `ahs`, `servicepower`, `squaretrade`, `nsa`, `frontdoor`. Free text for now — enforce via parser logic, not schema |
| `gmail_message_id` | text | yes | — | Gmail's stable message ID. **UNIQUE.** |
| `gmail_thread_id` | text | no | — | Useful for reply-chain grouping in the inbox |
| `sender` | text | no | — | `From:` header value |
| `subject` | text | no | — | Full subject line |
| `body_excerpt` | text | no | — | First 500 chars, already redacted (no PII) |
| `triggered_action` | text | no | — | What we did: `logged_only`, `created_job`, `updated_job_status`, `closed_job_cil`, `duplicate_ignored`, etc. |
| `resolution_note` | text | no | — | Human-readable why-this-action (e.g. "Call # 098894074139 matched existing job 5421") |
| `metadata` | object (JSON) | no | — | Vendor-specific parsed fields that don't fit on the `jobs` table (e.g. parsed dispatch sections, full extracted attribute map). Free-form JSON. |

### Indexes

| Type | Field(s) | Notes |
|---|---|---|
| primary | `id` | Default PK |
| UNIQUE | `gmail_message_id` | Idempotency — same Gmail message can never be processed twice |
| btree | `(job_id, created_at DESC)` | Per-job timeline view |
| btree | `(vendor, email_type, created_at DESC)` | Vendor-by-type queries (e.g. "all SquareTrade dispatch offers this week") |
| btree | `created_at DESC` | Recent-activity feed |

### Allowed `email_type` values (initial set, parser-enforced)

| Value | Meaning | Triggers action? |
|---|---|---|
| `DISPATCH_OFFER` | New dispatch — Call # may not exist in Xano yet | Creates job if Call # not seen |
| `DISPATCH_OFFER_ACCEPTED` | Post-accept confirmation (ServicePower "Service Request" subject vs. "Service Request Notice") | Updates job status if Call # exists |
| `SCHEDULE_CHANGE` | Reschedule notification | Updates `jobs.scheduled_*` fields |
| `CANCELLATION` | Job cancelled by customer or warranty company | Updates job status to `canceled` |
| `ESTIMATE_APPROVED` | Authorization approved | Updates job (likely `notes_internal` for now; field TBD) |
| `ESTIMATE_PENDING_REVIEW` | Authorization needs human review | Updates `manual_review_needed = true` |
| `CIL_ACCEPTED` | AHS Cash-In-Lieu accepted — job is dead from our side | Closes job + Danielle alert SMS (Decision 3) |
| `NOTES_ADDED` | Vendor added a note to an existing call | Appends to `notes_internal` |
| `STATUS_REQUEST_REMINDER` | Vendor wants a status update from us (SquareTrade cascade) | Logged only — Phase A3 will write back via SOAP |
| `RMA_AVAILABLE` | Parts return authorization issued | Logged only for now |
| `PARTS_SHIPPED` | Carrier shipped parts to customer | Updates `jobs.parts_status = "shipped"` |
| `COMPLETION_CONFIRMATION` | Vendor closed the case on their end | Updates job status |
| `FAILED_REPAIR` | Vendor flagged customer ongoing-issue escalation | Updates `manual_review_needed = true` |
| `SECOND_VISIT_DISPATCH` | New dispatch tied to a previous failed visit (SquareTrade pattern) | Creates new job with cross-ref to old in metadata |
| `DAILY_DIGEST` | Daily roll-up email (xlsx attachment) | Logged only — out of scope for v1 |
| `HUMAN_REPLY` | Free-form rep reply (Katelyn/Angie threads) | Logged only — skip parsing |
| `UNKNOWN` | Sender matches but subject pattern doesn't fit any known type | Logged only — flag for parser-pattern review |

This list is the v1 working set. Add new values as we discover patterns; no schema change required (text column).

### Allowed `triggered_action` values

| Value | Meaning |
|---|---|
| `logged_only` | Email captured for audit, no job touched |
| `created_job` | Newly created the parent `jobs` row + customer row |
| `updated_job_status` | Modified an existing job's status fields |
| `closed_job_cil` | Closed job because of AHS Cash-In-Lieu |
| `appended_notes` | Added text to `jobs.notes_internal` |
| `flagged_for_review` | Set `manual_review_needed = true` on the parent job |
| `duplicate_ignored` | Same `gmail_message_id` already exists — no-op |
| `customer_dedup_failed` | Both phone and address normalization failed; Danielle email triggered |
| `customer_dedup_partial_phone` | Address failed; flagged for review, no Danielle email |
| `customer_dedup_partial_address` | Phone failed; flagged for review, no Danielle email |

---

## Change 2 — `customer` table additions

Two new columns.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `dedup_signature` | text | no | — | Computed at write time: `{phone10}|{addr_norm}` for the happy path, with `NOPHONE` / `NOADDR` sentinels in partial cases. **Indexed (btree)** for lookup speed. **NOT unique** — rental owners may legitimately have multiple customer rows with the same signature if address normalization collides. |
| `related_customer_id` | int | no | — | Self-FK → `customer.id`. Populated when phone matches an existing customer but address differs (same person, distinct property). Points to the **first-created** row for that phone. **Set `table = "customer"`** on the FK so Xano renders the relation correctly. |

### Indexes

| Type | Field(s) | Notes |
|---|---|---|
| btree | `dedup_signature` | Primary dedup lookup |
| btree | `related_customer_id` | "Find all properties for this person" query |

---

## Change 3 — `jobs` table addition

One new column.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `manual_review_needed` | bool | no | `false` | Set to `true` when parser dedup is partial (phone-only or address-only) or when an email type indicates human attention is required. Surfaces in the cockpit for Teddy to triage. |

---

## Change 4 — Verify `jobs.claim_number` index

`claim_number` is the canonical join key for vendor emails (ServicePower Call #, AHS dispatch_id, NSA case#). The intake endpoint will `db.query jobs WHERE claim_number == $call_number` on every email — a frequent lookup that needs an index.

**Action:** In Xano admin UI, open the `jobs` table → Indexes tab → confirm one of these exists on `claim_number`:
- A btree index on `claim_number` alone, OR
- A composite btree starting with `claim_number`

If neither exists: **add a btree index on `claim_number`**. No unique constraint (the same claim_number can intentionally appear on multiple rows when we deliberately re-create dispatches in the smart-dedup model — see `job_email_event` for the audit trail).

---

## Application order (for Xano admin UI)

1. **Add new columns first** (no FKs yet):
   - `customer.dedup_signature` (text + btree index)
   - `customer.related_customer_id` (int, nullable; configure FK → customer with `table = "customer"`)
   - `jobs.manual_review_needed` (bool, default false)
2. **Verify** `jobs.claim_number` has a btree index; add if missing.
3. **Create `job_email_event` table** with all fields above. Configure FK `job_id → jobs` with `table = "jobs"`. Set up the four indexes (unique on `gmail_message_id` + three btree).
4. After applying, run `xano workspace pull` locally to mirror the new schema into `xano-workspace/table/*.xs` for reference. (No commit — `xano-workspace/` is gitignored.)

---

## What's intentionally NOT in this delta

- **No new `customer_property` table.** The simple model (one customer row per (phone, address) pair, linked via `related_customer_id`) handles rental/multi-property cases without a proper property table. Phase B can normalize this if it becomes painful.
- **No `vendor` enum on `jobs`.** Vendor information lives in `job_email_event` rows. `jobs.warranty_company` is the human-readable field; no need for a parallel structured enum.
- **No FK from `jobs` to `job_email_event`.** Reverse direction only (`job_email_event.job_id → jobs`). The `jobs` row is the canonical record; events are derived.

---

## Verification queries (after applying)

Run these via the Xano metadata API to confirm the schema landed:

```bash
# customer table has new columns
curl -H "Authorization: Bearer $XANO_META_TOKEN" \
  https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/6/schema \
  | jq '.schema[] | select(.name == "dedup_signature" or .name == "related_customer_id")'

# jobs table has manual_review_needed + claim_number index
curl -H "Authorization: Bearer $XANO_META_TOKEN" \
  https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/7/schema \
  | jq '.schema[] | select(.name == "manual_review_needed")'

# job_email_event table exists with all fields
curl -H "Authorization: Bearer $XANO_META_TOKEN" \
  https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table \
  | jq '.items[] | select(.name == "job_email_event")'
```
