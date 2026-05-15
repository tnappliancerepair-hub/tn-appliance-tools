# Financial Tracking & Payroll Automation — System Design

**Date:** 2026-05-15
**Status:** Implementation in progress (Phase 0 design — locked)
**Author:** Claude Code (Opus 4.7) for Teddy
**Replaces:** Meistertask (warranty job tracking spreadsheet), Danielle's manual payroll reconciliation, external bookkeeper

---

## 1 · Problem

TN Appliance Exchange currently runs the back office on three brittle inputs:

1. **Meistertask board** — manually moved cards as jobs flow from intake to "paid" status. No reconciliation, no aging visibility, no commission math.
2. **Danielle's payroll spreadsheet** — twice-monthly manual reconciliation against email remittances. Tech-by-tech commission math done by hand. The 2-day window between EFT arrival (1st/15th) and payroll cut (3rd/18th) is the entire reconciliation budget.
3. **External bookkeeper** — month-end pass over the same data the team already has. Lag of 30–45 days before P&L is "real."

The system replaces all three with email-parsed remittance intake, real-time job matching, automated commission calc, and an owner-facing dashboard that closes the loop without exporting to any external tool.

---

## 2 · Money flow (cash + warranty)

```
  ┌─────────────────────────────────────────────────────────────┐
  │  WARRANTY: SquareTrade / AHS / NSA  ──EFT──▶ Bank          │
  │            Email remittance ──poller──▶ Xano payment_batch │
  │            210 paper checks ──manual entry──▶ Xano         │
  │                                                              │
  │  CASH:     Stripe ──webhook (existing)──▶ Xano             │
  └─────────────────────────────────────────────────────────────┘
                              │
                              ▼
         warranty_payment_lines  ◄──FK──  jobs (matched on claim# / dispatch_id)
                              │
                              ▼
         job_financial (per-job: parts, labor, tax, commission, net profit)
                              │
                              ▼
         tech_payroll_lines  ──aggregate──▶  tech_payroll_periods
                              │
                              ▼
                  Owner approves payroll on day 2/3 of window
                              │
                              ▼
                  ACH to techs on 3rd / 18th
```

Pay cadence: **techs paid 3rd and 18th**. Warranty companies pay **1st and 15th**. The 2-day window between payment arrival and payroll cut is the reconciliation deadline.

---

## 3 · Commission rates

Stored as `decimal` field on the `technicians` table (added in Phase 1):

| Tech ID | Name           | commission_rate |
|---------|----------------|-----------------|
| 1       | Teddy (owner)  | `0`             |
| 2       | Jimmy          | `45`            |
| 3       | Andre          | `40`            |
| 4       | Lee Harding    | `50`            |
| 5       | Billy Savoy    | `40`            |
| 6       | John Houk      | `40`            |

Stored as integer-percentage (45 = 45%) for spreadsheet-friendly readability. Commission math: `commission = labor_paid * commission_rate / 100`.

**Self-pay (Stripe):** commission calculated real-time on stripe-webhook.js — no batch reconciliation.
**Warranty:** commission calculated when the warranty_payment_line is matched to a job.

---

## 4 · Tax handling

| Jurisdiction | Tax rate | Treatment |
|---|---|---|
| Tennessee | 9.25% on parts | Hardcoded constant, applied automatically |
| Louisiana | Varies by parish | **Manual entry per job** until lookup table built (Phase 5+) |

Tax applies to **parts only**, never labor. The `tax_amount` column on `warranty_payment_lines` carries the calculated amount; the `tax_rate` column carries the rate so it's auditable.

---

## 5 · Warranty vendor accounts

Seeded in `warranty_vendor_accounts` table (Phase 1):

| Company | Vendor # | State | Notes |
|---|---|---|---|
| ahs | 1-822418 | LA | Louisiana primary |
| ahs | 1-822218 | TN | Tennessee primary |
| ahs | _TBD_ | LA | Third LA account — number to be confirmed; row inserted with placeholder, flag `vendor_number_pending=true` |
| squaretrade_servicepower | TNA00001 | TN | Seed; other TNA##### IDs added on first sight by parser |
| nsa | _TBD_ | _TBD_ | One account, EFT, format unknown |
| 210 | _TBD_ | _TBD_ | One account, paper check — no email parsing |

Parser path: every incoming email batch reads the vendor number from the remittance header and looks up the account row. **Unknown vendor numbers create a new row automatically with `active=false`** so the owner reviews before commissioning anyone on those payments.

---

## 6 · New tables (full schema)

All field names use snake_case (matches workspace preference). Timestamps default `=now`.

### 6.1 `warranty_vendor_accounts`

```
id              int (PK)
created_at      timestamp =now (private)
company         text       // 'ahs' | 'squaretrade_servicepower' | 'nsa' | '210'
vendor_number   text       // '1-822418', 'TNA00001', check series, etc.
state           text       // 'TN' | 'LA' | '' (unknown)
area_description text      // e.g. "New Orleans metro", "Davidson County"
active          bool =true
notes           text?
```

Indexes: primary on id; btree on (company, vendor_number) UNIQUE.

### 6.2 `warranty_payment_batches`

```
id                int (PK)
created_at        timestamp =now (private)
vendor_account_id int (FK → warranty_vendor_accounts.id)
payment_date      timestamp     // EFT settlement / check date
period_ending     timestamp?    // from remittance header
eft_reference     text?         // EFT trace # / advice #
advice_number     text?
total_amount      decimal       // header total (NOT sum of lines — disputes detected by comparing)
gmail_message_id  text?         // idempotency anchor; null for manual entries
status            text =parsed  // 'parsed' | 'reconciled' | 'approved'
parsed_at         timestamp =now
approved_at       timestamp?
unmatched_count   int =0
disputed_count    int =0
matched_count     int =0
raw_text          text?         // original email body for audit
```

Indexes: primary; btree on (vendor_account_id, payment_date desc); UNIQUE on gmail_message_id where not null.

### 6.3 `warranty_payment_lines`

```
id                  int (PK)
created_at          timestamp =now (private)
batch_id            int (FK → warranty_payment_batches.id)
claim_number        text?       // SquareTrade / 210 / NSA claim ID
dispatch_id         text?       // AHS dispatch identifier
invoice_number      text?
customer_name       text?
model_number        text?
address             text?
labor_amount        decimal =0
parts_amount        decimal =0
other_amount        decimal =0
gross_amount        decimal =0  // header gross / invoiced
net_amount          decimal =0  // what they actually paid
total_amount        decimal =0  // == net by convention
job_id              int?        // FK → jobs.id (null if unmatched)
tech_id             int?        // FK → technicians.id (resolved from job after match)
match_status        text =unmatched   // 'matched' | 'unmatched' | 'disputed' | 'partial'
dispute_amount      decimal =0  // = gross - net when match_status='disputed'
dispute_notes       text?
resolution_status   text?       // 'unresolved' | 'accept_partial' | 'rebill' | 'write_off'
resolved_at         timestamp?
commission_amount   decimal =0
commission_rate     decimal =0
tax_amount          decimal =0  // 9.25% × parts_amount for TN; manual for LA
tax_rate            decimal =0
raw_line            text?       // original line text for audit
```

Indexes: primary; btree on batch_id; btree on (claim_number, dispatch_id); btree on job_id.

### 6.4 `tech_payroll_periods`

```
id                  int (PK)
created_at          timestamp =now (private)
period_start        timestamp
period_end          timestamp
pay_date            timestamp   // 3rd or 18th
status              text =pending  // 'pending' | 'approved' | 'paid'
total_labor_paid    decimal =0
total_parts_paid    decimal =0
total_commission_owed decimal =0
total_tax_collected decimal =0
approved_by         int?         // FK → user.id (owner)
approved_at         timestamp?
paid_at             timestamp?
notes               text?
```

Indexes: primary; btree on (period_end desc); UNIQUE on (period_start, period_end).

### 6.5 `tech_payroll_lines`

```
id                  int (PK)
created_at          timestamp =now (private)
period_id           int (FK → tech_payroll_periods.id)
tech_id             int (FK → technicians.id)
job_id              int?         // FK → jobs.id
warranty_payment_line_id int?    // FK → warranty_payment_lines.id (null for self-pay)
claim_number        text?
warranty_company    text?        // 'AHS' | 'SquareTrade' | 'NSA' | '210' | 'Cash'
labor_paid          decimal =0
commission_rate     decimal =0   // snapshot at time of pay (audit)
commission_amount   decimal =0
parts_paid          decimal =0
parts_cost          decimal =0
parts_markup_pct    decimal =0
parts_profit        decimal =0
tax_collected       decimal =0
tax_rate            decimal =0
```

Indexes: primary; btree on (period_id, tech_id); btree on job_id.

### 6.6 `job_financial` — extended fields

Added to the existing `job_financial` table (Phase 1, additive only):

```
warranty_payment_line_id      int?
warranty_vendor_account_id    int?
parts_markup_pct              decimal?
parts_revenue                 decimal?       // == parts_sell_price; aliased
labor_revenue                 decimal?       // == labor_price; aliased
tech_commission_amount        decimal?
tax_collected                 decimal?
tax_rate                      decimal?       // 9.25 for TN, varies LA
net_profit                    decimal?
paid_date                     timestamp?
eft_reference                 text?
```

Keeping the legacy field names (`labor_price`, `parts_sell_price`, etc.) — the new fields layer on top so existing readers don't break.

### 6.7 `technicians` — extended

Add one column:

```
commission_rate     decimal =0   // integer-percent (45 = 45%)
```

Seed values: Teddy(1)=0, Jimmy(2)=45, Andre(3)=40, Lee(4)=50, Billy(5)=40, John(6)=40.

---

## 7 · Endpoints

All under api_group `financial`. Naming follows the existing convention (`{name}_{verb}.xs`).

### 7.1 `squaretrade_payment_intake_POST`

**Input:** `{ rawText, gmail_message_id?, gmail_thread_id?, sender?, subject? }`

**Flow:**
1. Idempotency: if `gmail_message_id` present and a batch row already exists with it → return `{ ok: true, duplicate: true, batch_id }` (no-op).
2. Parse header: vendor number (`TNA#####`), EFT reference, period ending, total amount.
3. Lookup `warranty_vendor_accounts` by `company='squaretrade_servicepower'` + vendor_number. If miss → create row with `active=false`, SMS owner.
4. Insert `warranty_payment_batches` (status='parsed').
5. Foreach claim line: split fixed-width fields → `claim_number`, `customer_name`, `model_number`, `labor_amount`, `parts_amount`, `other_amount`, `total_amount`.
6. Per line:
   - Lookup `jobs` where `claim_number=line.claim_number` (or external ref match).
   - If matched: set `job_id`, `tech_id` from job, calculate commission (`tech.commission_rate * labor_amount / 100`), set `match_status='matched'`.
   - If gross != net (some payments arrive short): set `match_status='disputed'`, `dispute_amount=gross-net`, commission held until resolved.
   - If unmatched: increment `unmatched_count`, `match_status='unmatched'`.
   - Tax: TN job → `tax_amount = parts_amount * 0.0925`, `tax_rate=9.25`. LA → flag for manual.
7. Update batch counts (matched/unmatched/disputed).
8. SMS owner: `"SquareTrade payment parsed: $X total, Y matched, Z unmatched, W disputed"`.

**Response:** `{ ok, batch_id, total, matched_count, unmatched_count, disputed_count }`.

### 7.2 `ahs_payment_intake_POST`

Same shape. Match on `dispatch_id` (AHS) instead of `claim_number`. Otherwise identical logic.

### 7.3 `nsa_payment_intake_POST`

Best-effort parser. If parser confidence below threshold → store raw body in batch, set `status='needs_review'`, SMS owner immediately and route to dashboard inbox.

### 7.4 `manual_payment_entry_POST`

For 210 paper checks (no email parsing). Input: `{ vendor='210', vendor_number?, check_number, payment_date, claim_lines:[{claim_number, customer_name, labor_amount, parts_amount, total_amount}] }`. Same reconciliation logic, no idempotency check (no gmail_message_id). Batch created with `status='parsed'`.

### 7.5 `get_payroll_report_GET`

Input: `{ period_start, period_end }` (or `{ pay_date }` shortcut to derive). Returns:

```json
{
  "period": { "start": ..., "end": ..., "pay_date": ..., "status": "pending" },
  "techs": [
    {
      "tech_id": 2,
      "name": "Jimmy Pivacek",
      "commission_rate": 45,
      "lines": [{ "job_id, claim_number, warranty_company, labor_paid, commission_amount, parts_profit, tax_collected }],
      "totals": { "labor_paid": ..., "commission_owed": ..., "parts_profit": ..., "lines_count": ... }
    }
  ],
  "period_totals": {
    "total_labor": ..., "total_parts": ..., "total_commission_owed": ..., "total_tax_liability": ...,
    "disputed_jobs_count": ..., "disputed_amount_excluded": ...
  }
}
```

Disputed jobs are **excluded from commission totals** until resolved.

### 7.6 `approve_payroll_POST`

Input: `{ period_id }`.
1. Verify no `match_status='disputed'` lines in this period unresolved.
2. Snapshot all commission_amount values to `tech_payroll_lines` (lock).
3. Mark period `status='approved'`, `approved_at=now`, `approved_by=$auth`.
4. SMS owner with final per-tech totals.

### 7.7 `resolve_dispute_POST`

Input: `{ payment_line_id, resolution: 'accept_partial'|'rebill'|'write_off', notes? }`.
1. Update line: `resolution_status`, `resolved_at`, `dispute_notes`.
2. If resolution='accept_partial' → commission recalculated on net_amount.
3. If resolution='rebill' → match_status stays 'disputed', commission stays 0 (rebill creates a new line later).
4. If resolution='write_off' → match_status='matched', dispute_amount stays for reporting but commission=0.
5. Decrement batch `disputed_count`.
6. SMS owner with resolution summary.

### 7.8 `get_financial_dashboard_GET`

Input: `{ as_of? }` (defaults to now). Returns:

```json
{
  "outstanding": [{ "company, count, oldest_age_days, total_expected" }],
  "paid_this_period": [{ "company, count, total_paid" }],
  "commission_owed_this_period": [{ "tech_id, name, lines_count, total_owed" }],
  "disputed": [{ "line_id, claim_number, company, dispute_amount, age_days, customer_name" }],
  "tax_liability": { "this_period": ..., "ytd": ... },
  "pnl": { "this_month": { revenue, parts_cost, labor_paid, net }, "ytd": {...} },
  "parts_analysis": { "ytd_parts_cost, ytd_parts_revenue, avg_markup_pct" },
  "recent_batches": [{ "batch_id, company, payment_date, total, status" }]
}
```

### 7.9 `get_job_financial_summary_GET`

Input: `{ job_id }`. Returns the full per-job financial picture for the dashboard's job-drill modal.

### 7.10 `parts_markup_calc_GET` (small helper)

Input: `{ cost, tier? }`. Returns recommended markup % and resulting sell price per tier (e.g. low/standard/premium markup bands).

---

## 8 · Business rules (locked)

1. **Disputed → no commission.** Commission stays at 0 until `resolve_dispute_POST` clears the line.
2. **Tax = parts only.** Never on labor. TN=9.25 hardcoded. LA=manual entry per parish (Phase 5+ lookup).
3. **Unmatched claim = immediate SMS.** Owner needs visibility before payroll runs.
4. **Disputed amount = held from commission.** Even if the rest of the line matches.
5. **210 = manual entry only.** No poller branch — pure dashboard form.
6. **Self-pay = real-time.** Stripe webhook calculates commission on the spot; no batch reconciliation needed.
7. **Idempotency by gmail_message_id.** Every email intake checks first. Paper checks have no idempotency anchor — UI prevents double-entry via check_number unique check at the form.
8. **Unknown vendor number = auto-row + flag.** Parser creates `warranty_vendor_accounts` with `active=false`. SMS alerts owner. Owner activates from dashboard.
9. **Period locking.** Once payroll period status='approved', commission values cannot be recalculated. Audit trail preserved.
10. **Approved period cannot be reopened.** New disputes against jobs in approved periods create a credit/debit on the *next* period.

---

## 9 · Poller extension strategy

Both `ahs-gmail-poller.js` and `servicepower-gmail-poller.js` get a router added at the message-classification step:

```
classify(message):
  if subject matches /Dispatch|New Work Order|New Dispatch Notification/ → existing dispatch flow
  if subject matches /Payment|Remittance|EFT|Advice|Settlement/ → new payment flow
  else → log and skip (don't claim label, so retry-on-next-fire works)
```

The Gmail query is widened to catch payment subjects too. Parsers live in `netlify/functions/_lib/parsers/`:

- `servicepower-payment.js` — already-given fixed-width format
- `ahs-payment.js` — TBD format, built defensive (multi-pattern attempts)
- `nsa-payment.js` — built flexible, flags on low confidence

Each parser returns `{ format_confidence, header, lines[] }` and the poller POSTs to the matching Xano intake.

---

## 10 · Dashboard (`financial-dashboard.html`)

PIN-gated using existing `verify-pin-proxy.js` pattern. Tech IDs allowed: **1 only** (Teddy/owner). All other PINs rejected.

**Sections:**

1. **Payment inbox** — last 20 batches: company, date, total, status (parsed/reconciled/approved), match rate, jump-to-detail.
2. **Outstanding jobs** — unpaid grouped by warranty company, with aging buckets (0–30, 31–60, 61–90, 90+).
3. **Current payroll period** — current period summary; per-tech commission owed; APPROVE button (calls `approve_payroll_POST`); disabled when unresolved disputes exist.
4. **Disputed jobs** — list with claim#, company, dispute_amount, age; resolve-modal with three buttons.
5. **Tax liability** — this period and YTD, by jurisdiction.
6. **P&L summary** — month and YTD, revenue/cost/profit.
7. **Manual entry (210)** — form for paper-check entry; same reconciliation logic.
8. **Parts markup calculator** — enter cost, get recommended sell price by tier.

Built with the same dark/orange aesthetic as the rest of the site for consistency. Mobile-responsive — Teddy approves payroll from the field via Cybertruck dashboard.

URL: `/financial-dashboard` (PIN gate; no public link from main nav).

---

## 11 · Deployment

| Layer | How it deploys |
|---|---|
| Xano tables & endpoints (`.xs` files in `xano-workspace/`) | Source-of-truth in repo. Apply to live Xano via `xano push` from a workstation with `~/.xano/credentials.yaml`. Manual UI paste is the fallback. |
| Netlify functions (poller extensions, parsers) | `git push` → Netlify auto-deploys |
| Dashboard HTML | `git push` → Netlify auto-deploys |

**One-time deployment order after merge:**

1. Apply Xano tables (Phase 1) via `xano push`. Verify seed rows present.
2. Apply Xano endpoints (Phase 2) via `xano push`. Smoke-test each via `curl` with fixture payload.
3. Push Netlify functions (Phase 3). Manual fire on a real payment email after fixture verification.
4. Push dashboard HTML (Phase 4). PIN-gated access from Teddy.

---

## 12 · Out of scope (explicit)

- LA parish-level sales tax lookup table (Phase 5+ — for now, LA tax is manual per job).
- AHS third LA vendor number (placeholder row inserted; updated when discovered).
- NSA email format reverse-engineering (parser built flexible; flag-and-review pattern until first real fixture).
- Migration of existing Meistertask job records (Phase 1 launches new — historical data lives in Meistertask read-only).
- External bookkeeper data export (Phase 6+ — system stays self-contained until trusted in production).

---

## 13 · Open questions for Teddy

1. **AHS 3rd LA vendor number** — what's the actual identifier? (Row inserted with `vendor_number_pending=true`; just update when known.)
2. **210 check number format** — sequential? Are check numbers ever recycled across years? (Affects whether the UI's duplicate-check should scope by year.)
3. **Owner PIN** — confirm Teddy is technician_id=1 in production. (Dashboard hardcodes this; trivial to change.)
4. **SMS frequency tolerance** — payment-parsed and unmatched-claim alerts could batch noisy on a heavy day. Currently sends one SMS per batch. Adjustable.
5. **LA tax** — manual-per-job for now. When the parish-lookup is worth building, send the parish→rate spreadsheet.

---

## 14 · Index

- Tables: §6
- Endpoints: §7
- Business rules: §8
- Pollers: §9
- Dashboard: §10
- Deployment: §11
