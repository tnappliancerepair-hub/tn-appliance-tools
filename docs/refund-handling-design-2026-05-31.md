# Refund Handling — Design

**Date:** 2026-05-31
**Status:** Design (not implemented)
**Trigger:** Customer or office initiates refund post-payment

---

## 1 · Why this is missing

Refunds are low frequency but inevitable. Today: completely manual. If a Stripe-charged customer gets a refund, Teddy issues it via the Stripe dashboard. No audit row in Xano. No commission clawback. No SMS confirmation. No tie-back to the job.

This causes:
- P&L drift (refunded revenue still counted in commission base)
- No visibility — Danielle/Teddy don't know which jobs were refunded without checking Stripe
- Tech commission gets paid on jobs that subsequently refunded

---

## 2 · Scope

**In scope:**
- Self-pay (Stripe-charged) refunds: full + partial
- Warranty job refunds (rare — happens if a customer is double-charged or charged in error)
- Tech commission clawback when a refund hits within the payroll period
- Customer-facing confirmation SMS
- Audit row in `event_log` + new `refunds` table

**Out of scope (Phase 1):**
- Disputed payments (Stripe chargebacks — different code path; handled by `stripe-webhook.js` future extension)
- Warranty company short-pays (already covered by 5/15 design's `resolve_dispute_POST`)
- Refunds older than 90 days (Stripe restricts; manual fallback)

---

## 3 · Trigger flow

```
Customer requests refund (call / SMS / email)
        │
        ▼
Office adjudicates (Teddy or Danielle, eventually Teddy A/B/C SMS)
        │
        ▼
POST /refund_initiate { job_id, amount?, reason, approved_by }
        │
        ▼
Xano: validate, lookup original Stripe charge, call Stripe Refund API
        │
        ├── Stripe success ─────────────────────────────────────────────────────┐
        │                                                                       │
        ▼                                                                       │
Write `refunds` row + event_log row + adjust job_financial.refund_amount        │
        │                                                                       │
        ▼                                                                       │
Emit REFUND_PROCESSED signal                                                    │
        │                                                                       │
        ├── customer SMS (gated by CUSTOMER_FACING_ENABLED)                     │
        │   "Your refund of $X for job #Y has been processed. Allow 5-10        │
        │    business days for it to appear."                                   │
        │                                                                       │
        ├── commission clawback (if tech_earnings row exists for this job and   │
        │   period not yet paid: zero out commission_earned)                    │
        │                                                                       │
        └── Teddy SMS (always): "[ant] refund $X processed on job #Y -          │
            customer {name} - reason: {reason}"                                 │
                                                                                │
        ◄───────────────────────────────────────────────────────────────────────┘
```

---

## 4 · New table — `refunds`

```
id                    int (PK)
created_at            timestamp =now
job_id                int (FK)
customer_id           int (FK)
amount                decimal           // positive number
original_charge_id    text              // Stripe charge ID being refunded
stripe_refund_id      text?             // Stripe's refund object ID after success
reason                text              // free text from operator: "wrong appliance", "double-charge", "customer dispute - granted"
approved_by_tech_id   int               // 1 = Teddy; future: per-operator
status                text =pending     // 'pending' | 'succeeded' | 'failed' | 'manual_required'
stripe_error          text?             // populated if Stripe call fails
clawback_amount       decimal =0        // commission clawed back from tech
clawback_tech_id      int?
customer_sms_sent     bool =false
processed_at          timestamp?
```

Indexes: primary; btree on job_id, customer_id, status.

---

## 5 · New endpoints

### 5.1 `refund_initiate_POST.xs`

**Input:** `{ job_id, amount? (optional — defaults to full charge), reason, approved_by_tech_id }`

**Flow:**
1. Lookup `job_financial` row + customer
2. Validate `job_financial.payment_collected = true` and Stripe charge exists
3. Look up original charge via `stripe-webhook` audit (we already store this) or via Stripe API
4. Call `POST https://api.stripe.com/v1/refunds` with `{ charge: <id>, amount: <cents> }`
5. On success: insert `refunds` row with `status=succeeded`, `stripe_refund_id`
6. Emit `REFUND_PROCESSED` colony signal
7. On failure: insert `refunds` row with `status=failed`, `stripe_error=<reason>`. SMS Teddy.

**Response:** `{ ok, refund_id, status, stripe_refund_id?, customer_will_see_in_days: 5-10 }`

### 5.2 `refund_lookup_GET.xs`

**Input:** `{ job_id }` or `{ refund_id }` or `{ days_back }`

**Returns:** list of refunds for the lookup criteria, with associated job + customer info. Powers an "Refunds" section on the financial dashboard.

---

## 6 · New agent — `refund_processed.js`

Consumes `REFUND_PROCESSED`:
1. Load refund + job + customer
2. Send customer confirmation SMS (gated)
3. Send owner SMS (always — internal bypass)
4. If `clawback_amount > 0`: find pending `tech_earnings` row for this job and current open payroll period. Zero out `commission_earned`. Write `event_log` action="commission_clawed_back".
5. Audit row in event_log: `refund_processed_handled`

---

## 7 · UX — Financial dashboard "Refunds" section

New section on `financial-dashboard.html`:
- Initiate refund button (modal: job_id input → job preview → amount + reason → confirm)
- Last 30 days refunds list
- Status badges (pending/succeeded/failed/manual_required)
- For `failed` rows: "Retry" button or "Mark manual" button

---

## 8 · Business rules

1. **Refund > original charge: hard reject.** Stripe will fail this anyway.
2. **Refund on already-paid commission: claw back next period.** If the payroll period for that job has been `approved`, the clawback creates a debit on the next period (per design §8 rule 10).
3. **Warranty refund:** if `customer_type=warranty`, the refund flow doesn't touch the warranty payment line (those are tracked separately). Only refunds self-pay portions (Quick Check $50, parts paid out of pocket, etc.).
4. **Refund without job_id:** rejected. Every refund must tie to a job (audit requirement).
5. **No automatic refunds.** Always operator-initiated (no agent decides to refund).

---

## 9 · Effort estimate

- New table: 15 min (Metadata API + verify schema)
- 2 endpoints (initiate + lookup): 1-2h XS work
- 1 agent: 30 min (mirrors existing pattern)
- Dashboard section: 1h
- Smoke test: 30 min

**Total: half a day.** Ship Thursday 6/4 per the activation plan.

---

## 10 · Open questions

1. **Who can initiate refunds?** Today, only Teddy (tech_id=1). Future: Danielle? Add `authorized_refund_tech_ids` config? Default to owner-only.
2. **Clawback if period already paid:** debit next period (per design rule 10) — but what's the operator UX? Probably auto-applies + SMS the tech: "[ant] $X clawback this period: job #Y was refunded after your last payout. Net adjusted."
3. **Stripe webhook for `charge.refunded`:** Stripe also fires a webhook when a refund is processed (even if we initiated it). Either swallow it in our `stripe-webhook.js` (we already wrote the row) or use it as a second-channel confirm. Recommend: dedup against our own `refunds` table.
