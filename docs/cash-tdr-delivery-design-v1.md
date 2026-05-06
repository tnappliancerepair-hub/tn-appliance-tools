# Cash Flow TDR Delivery — Design v1

**Status:** Scoping in progress. Sections 1-4 LOCKED per Teddy's brief. **4 design decisions LOCKED 2026-05-05** that resolved §16 q2/q3/q16 and added a new operating rule (D4): unified `scheduling_status` (D1), customer-facing fields on TDR (D2), judgment-driven labor pricing (D3), pre-work labor adjustment rule (D4). Sections 6, 7, 9, 12, 15 updated accordingly. Sections 5-16 remain PROPOSED SHAPES — confirm or rewrite each before any build commitment.

**Last updated:** 2026-05-05 (4 locked decisions: scheduling_status / TDR fields / judgment labor / pre-work adjustment)

**Owner:** Teddy / James Pivacek

**Estimated build:** TBD pending review of proposed sections

> **⚠️ Speculative content flagged.** Sections 1-3 are the locked policy (with §3 updated 2026-05-05 for multi-failure + judgment-driven labor + pre-work adjustment). Section 4 is the locked multi-failure + multi-party requirement (added 2026-05-05). Sections 5-16 are proposed shapes synthesized from existing design docs (`inbound-pipeline-design-v1.md`, `gmail-integration-design-v1.md`, `ant-tech-assist-design-v1.md`) and the cash-flow-TDR domain. **Locked decisions D1–D4 (2026-05-05)** are reflected in §6 (state machine), §7 (schema), §9 (operating rules), §12 (failure modes), §15 (operational handoff), and §16 (resolved subsection). Every still-proposed section has a ⚠️ marker; treat each as "draft, edit freely" until reviewed. Open questions in §16 are the real unknowns.

---

## 1. Mission

Every $50 QC customer who completes intake gets an honest pre-diagnosis with four explicit repair options. The product they pay for is the diagnosis-plus-options menu. The flow captures revenue on every outcome — DIY part purchase, full-service repair, or even decline — by making the $50 the entry point into a productized triage offering.

---

## 2. Why this exists

### Today's reality

Cash $50 QC flow doesn't exist end-to-end. Customer Ant chat captures intake. Stripe payment links exist. HCP integration exists. Teddy Tool shows job info (now wired with the `diagnosis` field as of commit `e8bfe72`, 2026-05-05). But there's no path from "customer paid $50" → "customer receives diagnosis with options" → "customer chooses path."

### Tomorrow's vision

Customer completes intake (free, builds commitment), pays $50 to unlock pre-diagnosis, receives a productized options menu, picks one of four paths, payment + fulfillment happens automatically.

---

## 3. The four customer options (PER FAILURE) — POLICY UPDATED 2026-05-05

> **Updated 2026-05-05:** This section was originally written assuming one repair decision per job. Real customer pattern shows 10-30% of jobs have multiple distinct failures, with the customer (especially in cash flow) often deciding per-failure. The four options below now apply **per failure**, not per job. See §4 for the multi-failure + multi-party architecture.

Each failure on the TDR gets its own four-option pricing menu, plus an explicit fifth "Skip" option. Pricing is **per failure** — the customer can mix and match across failures. **Example pricing only — actual numbers come from Teddy's diagnosis input per failure.**

| Option | Price example (per failure) | What customer gets | What we do |
|---|---|---|---|
| **DIY OEM Part** | $280 part + free shipping | Brand-name original part shipped | Send part, no labor |
| **DIY Amazon Equivalent** | $95 part + free shipping | Aftermarket equivalent shipped | Send part, no labor |
| **We Install It (OEM)** | $445 ($215 labor + $280 part − $50 credit on first We Install) | OEM part + tech installs | Truck roll, install, complete repair |
| **We Install It (Amazon)** | $260 ($215 labor + $95 part − $50 credit on first We Install) | Amazon part + tech installs | Truck roll, install, complete repair |
| **Skip this repair** | $0 | Acknowledgment only — failure noted, not fixed | Document and close out this failure |

### Pricing rules (locked)

- The $50 already paid for diagnosis credits **ONLY ONCE per job**, against the first We Install option chosen — does not stack or multiply across failures.
- DIY paths get the part at full price — the $50 was the assessment fee, parts are separate.
- Pricing is per-failure — Teddy enters labor estimate + OEM part number/price + Amazon equivalent number/price **per failure** into Teddy Tool, the four options render automatically off those inputs **for each failure**.
- "Skip this repair" is always free and always available per failure on cash jobs. Useful for rental scenarios where landlord declines a non-critical repair, or for customers prioritizing budget across multiple failures.
- **Warranty path override:** warranty jobs **do not show "Skip"** — all failures are repaired (warranty co requirement; partial repair invalidates the claim).
- **Labor pricing is judgment-driven, not formula-driven (LOCKED 2026-05-05 — Decision 3).** Teddy enters per-failure labor estimates using domain knowledge about which failure is "first repair" (full labor) vs "incremental" (reduced labor because the tech is already on-site). No fixed `first_failure_full / additional_failure_incremental` formula. The bundling effect happens through Teddy's per-failure judgment, not through a separate column or computed multiplier. `tdr_failure.estimated_labor_price_cents` stays as the single per-failure column. (Resolves §16 q16.)

### Operating rules (LOCKED 2026-05-05 — shown to customer on the TDR view page, see §9)

- **Pre-work labor adjustment (Decision 4).** If when the technician arrives, the actual labor turns out to differ from the quoted estimate, the tech tells the customer the new price **before starting any work**. Customer chooses: (a) accept the new price, or (b) have the unopened part returned (if applicable — opened parts are non-returnable per existing operating rules). Once work begins, the agreed price is final — no mid-job adjustments.
- The tech does not start work until the customer agrees to the price.
- Operational SOP for documenting the adjustment (schema update mechanics, customer confirmation method, Stripe rebilling) is ⚠️ open — see §16 q17.

---

## 4. Multi-failure + multi-party customer support (LOCKED 2026-05-05)

Two real production patterns observed today (2026-05-05) that v1 must support natively:

### Pattern A: Multi-failure jobs

10-30% of diagnosis events surface more than one distinct failure on the same appliance. Examples:
- Refrigerator: ice maker fails AND door gasket torn
- Washer: drain pump bad AND bearings noisy
- Oven: bake element burnt AND control panel intermittent

**Cash multi-failure:** customer decides per-failure. Common to fix the critical issue and skip the cosmetic/marginal one. Per-failure pricing menu (§3) is the mechanism.

**Warranty multi-failure:** never skip — all failures are repaired. Warranty company requirement; partial repair invalidates the claim or requires re-submission. The customer-facing TDR for a warranty job shows all failures with no "Skip" option (UI hides it; API rejects skip transitions on warranty jobs).

### Pattern B: Multi-party customers (rental / commercial)

`bill_to` ≠ `on_site_contact`. The party who reports the symptom is not the party who pays or makes the repair decision. Real case observed 2026-05-05:

- Tenant reported "won't heat" via Ant intake (the `on_site_contact`).
- Teddy diagnosed in person and ALSO found a loud bearing not mentioned by the tenant.
- TDR went to landlord (the `bill_to`), who decides per-failure: fix the heat issue (critical), skip the bearing (cost call).

**Other multi-party scenarios anticipated:**
- Commercial accounts (property manager pays, on-site staff reports)
- Vacation rental managers (manager pays, guest or cleaner reports)
- Second-home owners (out-of-state owner pays, neighbor or caretaker on-site)

**Tenant-reported symptoms vs technician-found failures** must be distinguished on the TDR. The landlord seeing the report needs to know which failures the tenant complained about (rental-relationship implications) vs which failures Teddy surfaced during diagnosis (where the tenant may not even be aware of them).

### Implications for v1

- Each TDR is a header record (one per job) with N failure children — see §7 schema.
- Each failure carries a `tenant_reported` flag.
- Each failure has its own `selected_option` enum (incl. `skip`).
- Job-level state aggregates over failure-level decisions — see §6 state machine.
- Customer-facing page renders N failure cards stacked, each with the four-plus-Skip menu — see §9.
- Rental flow has its own SMS template variant and recipient routing — see §9.
- Decision authority on options is `bill_to` only in rental scenarios — tenant cannot pick options.

---

## 5. End-to-end flow ⚠️ PROPOSED — confirm channels and trigger points

> Proposed actor-and-channel sequence. Built off the existing intake/Customer-Ant + HCP-integration + Teddy-Tool patterns. Channel choices (SMS vs email) and trigger mechanics (push vs pull) need confirmation. The rental variant (Pattern B from §4) is captured below as a divergence at steps 5-7.

```
1. INTAKE (free)
   Customer ↔ Customer Ant chat (web)
   → creates jobs row in Xano, qc_status="intake_complete"
   → if rental: also captures bill_to (landlord) + on_site_contact (tenant)
                and sets is_rental=true
   ↓
2. QUICK CHECK PITCH
   Customer Ant pitches $50 Quick Check naturally during intake
   → on customer agreement, fires Stripe payment-link generation
   ↓
3. PAYMENT LINK SENT
   Customer receives SMS or chat link to Stripe checkout for $50
   qc_status="payment_link_sent"
   ↓
4. CUSTOMER PAYS $50
   Stripe webhook → Xano qc_payment_webhook
   qc_status="diagnosis_pending"
   ↓
5. TEDDY NOTIFIED
   SMS to Teddy + Teddy Tool dashboard ping
   ↓
6. TEDDY DIAGNOSES (Teddy Tool, multi-failure UI)
   Reviews intake info + photos. For EACH failure found:
     - failure_description text
     - tenant_reported flag (was this in the intake/on-site complaint
       or did Teddy surface it during diagnosis?)
     - OEM part number + price
     - Amazon equivalent number + price
     - labor estimate (per-failure)
   Submit → compose_qc_diagnosis endpoint creates one tdr header
            + N tdr_failure rows
   qc_status="diagnosis_sent"
   ↓
7. CUSTOMER NOTIFIED  (or LANDLORD NOTIFIED in rental scenario)
   Standard:
     send_qc_diagnosis_to_customer fires SMS to bill_to_customer
   Rental variant (jobs.is_rental = true):
     SMS to bill_to (landlord) using qc_diagnosis_ready_rental template
     Tenant (on_site_contact) optionally gets FYI SMS — see §16 q3
   qc_status="choice_pending"
   ↓
8. CUSTOMER CHOOSES (per-failure)
   Public page renders N failure cards.
   Customer (bill_to in rental case) taps one option per card.
   POSTs to qc_customer_choice for each card (or batched submit).
   tdr_failure.selected_option set per row.
   When every tdr_failure.selected_option != pending:
     Job-level qc_status flips based on aggregate (see §6).
   ↓
9. FULFILLMENT BRANCHES (per failure, then aggregated)
   ├── DIY paths → Stripe charge per part →
   │   parts ordered (manual v1) →
   │   shipped to bill_to address →
   │   tracking SMS to bill_to
   │
   ├── We Install paths → Stripe charge (sum of all We Install failures,
   │   with $50 credit applied ONCE on first We Install) →
   │   single HCP appointment booked covering all install failures →
   │   tech rolls, fixes all chosen failures in one visit →
   │   on completion: feedback SMS chain to bill_to + on_site_contact
   │
   └── Skip paths → no charge, recorded as skipped, closed out

   When ALL failures reach a terminal state (fulfilled or skipped):
     qc_status="fulfillment_complete"  (no skips)
       OR  "fulfillment_partial"        (some skips, some fulfilled)
       OR  "all_skipped"                (every failure skipped — terminal)
```

### Channels

⚠️ Proposed: SMS for all customer-facing touchpoints (mirrors the rest of the platform). Email as fallback if customer didn't consent to SMS at intake. Customer-facing diagnosis page is web (responsive, mobile-first).

### Triggers between handoffs

⚠️ Proposed:
- Stripe → Xano: webhook
- Xano → Teddy: SMS via existing `send_sms` endpoint, plus a Teddy Tool dashboard query that surfaces "diagnosis_pending" jobs
- Xano → Customer (or Landlord): SMS with signed-link URL (token in URL, validated by Xano on page load)
- Customer page → Xano: AJAX POST per failure choice
- Xano → Stripe: API call to create checkout session for option-specific payment

### Rental flow variant (Pattern B)

⚠️ Proposed:
- `jobs.is_rental` flag set during intake (Customer Ant asks "is this a rental?" or detects from intake context).
- `bill_to_customer_id` and `on_site_contact_id` set during intake — bill_to from landlord info (collected by Customer Ant), on_site_contact from the tenant who's chatting.
- Step 7 routes the diagnosis SMS to bill_to (landlord) using the rental SMS template.
- Tenant gets a separate FYI SMS (optional, gated on §16 q3).
- Decision authority on options is bill_to only — tenant cannot pick options (UI gates by signed-token party identity).
- Fulfillment SMS (parts shipped, tech scheduled) goes to BOTH bill_to AND on_site_contact (tenant needs to know when tech is coming).

---

## 6. State machine for the QC pipeline — LOCKED 2026-05-05 (Decision 1)

> **Decision 1 (locked 2026-05-05):** Pre-diagnosis is the SAME process for cash and warranty (both go to Teddy for remote review). Only the post-pre-diagnosis path diverges — warranty schedules a home visit; cash sends the customer-facing TDR with options. The shared operational state lives on the existing `scheduling_status` enum (extended with new shared values). Cash-specific commercial state lives on a new `qc_status` column (NULL for warranty jobs). Resolves §16 q2.

### Shared operational state — `scheduling_status` (extended)

The existing `scheduling_status` enum gains 4 new values used by both cash and warranty:

```
intake_complete         (customer finished intake, ready for Teddy review)
prediagnosis_pending    (waiting for Teddy to pre-diagnose — both cash AND
                         warranty queue here)
needs_more_info         (Teddy reviewed, needs more from customer
                         before proceeding)
no_fix_possible         (Teddy determined the unit can't be repaired)
```

Existing values (`pending`, `awaiting_parts`, `ready`, `broadcasting`, `scheduled`, `in_progress`, `completed`, `escalated`, `canceled`, `held`) are unchanged.

**Cash priority:** cash jobs (`qc_status NOT NULL`) get queue priority over warranty jobs of similar age in `prediagnosis_pending`. They paid $50 to skip the line. Surface in Teddy Tool dashboard with a sort/badge.

### Cash-only commercial state — `qc_status` (new column, NULL for warranty)

```
diagnosis_pending  ← (the $50 just landed, awaiting Teddy composition)
   │
   ▼
diagnosis_sent     ← (Teddy composed N failures, customer SMS sent)
   │
   ▼
choice_pending     ← (waiting for customer to pick options on all failures)
   │
   ├──→ partial_chosen    (some failures have options, others still pending —
   │                       see timeout in §12)
   ├──→ all_chosen        (every failure has an option, payment phase begins)
   ├──→ all_skipped       (every failure skipped — terminal, declined-equivalent)
   ├──→ abandoned         (no completion within timeout — see §12)
   ├──→ refunded          (terminal, post-refund)
```

Note: `intake_complete` and the pre-payment lifecycle previously drafted as `qc_status` values now live on the shared `scheduling_status` enum. `qc_status` carries only the cash-specific commercial states above.

### Per-failure state machine — `tdr_failure.selected_option`

```
pending      (default — Teddy added the failure, customer hasn't chosen yet)
   │
   ├──→ diy_oem        (customer picked DIY OEM)
   ├──→ diy_amazon     (customer picked DIY Amazon)
   ├──→ install_oem    (customer picked We Install OEM)
   ├──→ install_amazon (customer picked We Install Amazon)
   └──→ skip           (customer picked Skip this repair)
```

Plus a `fulfilled_at` timestamp on `tdr_failure` for tracking when each individual repair completes.

### Aggregation rules

- Job has `qc_status = all_chosen` only when every `tdr_failure.selected_option != pending`.
- Job has `qc_status = all_skipped` when every `tdr_failure.selected_option = skip`.
- Job transitions `scheduling_status` to `completed` when every `tdr_failure` is either `fulfilled_at IS NOT NULL` (paid path completed) OR `selected_option = skip`.
- **Warranty jobs cannot transition any failure to `skip`** — enforced at API layer, not just UI.

Terminal `qc_status` values: `all_skipped`, `abandoned`, `refunded`, plus reaching `scheduling_status = completed` end-state.

---

## 7. Schema additions ⚠️ PROPOSED — REVISED 2026-05-05

### Extensions to existing `jobs` table

Mix of "extend existing enum" and "add new columns":

#### Extending existing `scheduling_status` enum (shared, cash + warranty — LOCKED Decision 1)

Add 4 new values: `intake_complete`, `prediagnosis_pending`, `needs_more_info`, `no_fix_possible`. Existing values unchanged.

#### New columns

| Column | Type | Purpose |
|---|---|---|
| `qc_status` | enum (cash-only states from §6, NULL for warranty) | The cash commercial pipeline state |
| `qc_diagnosis_paid_at` | timestamp, nullable | When the $50 came in via Stripe |
| `qc_diagnosis_sent_at` | timestamp, nullable | When the customer-facing diagnosis SMS fired |
| `qc_choice_made_at` | timestamp, nullable | When the customer's last failure-choice was recorded |
| `qc_customer_choice` | enum (legacy single-failure marker, see migration note below) | Their pick — preserved for v1 phases pre-1f |
| `bill_to_customer_id` | int FK customer, nullable | Defaults to existing `customer_id` if NULL. Set explicitly for rental/multi-party. |
| `on_site_contact_id` | int FK customer, nullable | Defaults to existing `customer_id` if NULL. Set to the tenant in rental scenarios. |
| `is_rental` | bool, default false | Triggers the rental SMS template variant + fulfillment-recipient routing |

The existing `customer_id` column stays as the "primary" customer for backward compatibility. New code reads `bill_to_customer_id ?? customer_id` for billing decisions and `on_site_contact_id ?? customer_id` for on-site comms.

### `technician_decision_report` extensions (LOCKED Decision 2)

> **Decision 2 (locked 2026-05-05):** Customer-facing diagnosis fields live on TDR, not on a separate `qc_diagnosis_offer` table. The "internal vs customer-facing" distinction is enforced at the API layer (different endpoints return different field sets), not at the schema layer. Resolves §16 q3.

The existing TDR becomes a one-per-job header record (existing fields like `diagnosis`, `technician_id`, `problem_summary`, `failure_cause`, `status` stay). Add the following customer-facing columns:

| Column | Type | Purpose |
|---|---|---|
| `customer_facing_diagnosis` | text, nullable | Plain-English version distinct from internal `diagnosis` field — sanitized for customer view |
| `public_view_token` | text, indexed | Signed token for the SMS link to `cash-tdr-customer.html` |
| `sent_to_customer_at` | timestamp, nullable | When the customer-facing TDR SMS fired |
| `viewed_at` | timestamp, nullable | When the customer first opened the link |
| `expires_at` | timestamp, nullable | When the public link should stop accepting choices |
| `labor_credit_cents` | int default 5000 | The $50 applied ONCE per job on the first We Install option chosen |

Per-repair fields (`verified_part_number`, `estimated_repair_cost_range`, `parts_used`, `parts_not_used`, `failed_component`) move conceptually to `tdr_failure`. Existing columns on TDR are NOT dropped in v1 (additive migration only). Phase 1f migration creates one tdr_failure row per existing TDR.

### NEW table: `tdr_failure`

⚠️ One row per failure on a TDR.

```
id (pk)
created_at
tdr_id (fk technician_decision_report)
failure_description (text)        — Teddy's plain-English description of this specific failure
tenant_reported (bool)            — true if this failure came from intake / on-site complaint;
                                    false if Teddy surfaced it during diagnosis
recommended_oem_part_number (text)
recommended_oem_part_price_cents (int)
recommended_amazon_part_number (text, nullable)
recommended_amazon_part_price_cents (int, nullable)
estimated_labor_price_cents (int)  — labor for THIS failure specifically
                                     (see §16 q5: bundled vs per-failure)
selected_option (enum: pending, diy_oem, diy_amazon, install_oem, install_amazon, skip)
selected_at (timestamp, nullable)
fulfilled_at (timestamp, nullable) — for tracking completion of this specific failure
```

### ~~NEW table: `qc_diagnosis_offer`~~ — REMOVED 2026-05-05 (Decision 2)

The previously-proposed `qc_diagnosis_offer` table is gone. Its fields are now on `technician_decision_report` (see "TDR extensions" above). The `status` enum it carried (draft / sent / viewed / partially_chosen / fully_chosen / expired) is replaced by deriving status from the existing `qc_status` + `tdr_failure.selected_option` aggregate (no separate column needed).

### NEW table: `stripe_payment_intent` ⚠️ PROPOSED

⚠️ Tracks all Stripe charges for a job (the $50, plus the second option-specific charge). Could also be a column on jobs but a separate table allows for retries, refunds, and audit cleanly.

```
id (pk)
created_at
job_id (fk jobs)
tdr_failure_id (fk tdr_failure, nullable)  — non-null for option payments,
                                             null for the $50 entry payment
stripe_payment_intent_id (text)
purpose (enum: qc_diagnosis_50, option_payment, refund)
amount_cents (int)
status (enum: created, succeeded, failed, refunded, canceled)
succeeded_at (timestamp, nullable)
metadata (json) — Stripe webhook payload audit
```

⚠️ **Open question:** does the existing job_financial table cover this? Need to inspect — it might already have payment_status fields suitable for extending.

### Customer table

⚠️ No new fields needed. `bill_to_customer_id` and `on_site_contact_id` on `jobs` are FKs to existing `customer` rows. Customer Ant intake captures both parties as separate customer records when `is_rental` is true.

---

## 8. New endpoints ⚠️ PROPOSED

| Endpoint | Method | Caller | Purpose |
|---|---|---|---|
| `compose_qc_diagnosis` | POST | Teddy Tool (extends existing `submitTDR`) | Creates the TDR header + N tdr_failure rows + qc_diagnosis_offer row, computes prices, sets `qc_status="diagnosis_sent"` |
| `send_qc_diagnosis_to_customer` | POST | called inside `compose_qc_diagnosis` or as separate trigger | Generates signed token, sends SMS — routes by `is_rental` flag to standard or rental template |
| `qc_diagnosis_view` | GET | customer-facing page on load | Validates signed token, returns TDR header + N failures + four-options-per-failure for the page to render |
| `qc_customer_choice` | POST | customer-facing page on click | Records the choice for ONE tdr_failure row, returns running total. When all failures chosen, generates the option-specific Stripe checkout session |
| `qc_stripe_webhook` | POST | Stripe | Handles `payment_intent.succeeded` for both the $50 and the option payment; flips `qc_status` accordingly |
| `qc_compose_reminder` | POST | cron task (15 min) | Finds `diagnosis_pending` jobs older than N hours, SMS Teddy |
| `qc_choice_reminder` | POST | cron task (1 hr) | Finds `choice_pending` or `partial_chosen` jobs older than N days, SMS bill_to |

### Tools the customer-facing page needs

⚠️ The signed token approach mirrors HCP webhook setup pattern. The token encodes job_id + qc_diagnosis_offer.id + party-identity (bill_to vs on_site_contact, for rental access gating) + expiry, signed by Xano with an env var secret. Page calls `qc_diagnosis_view?token=...` to fetch render data; same token used for `qc_customer_choice` POST.

---

## 9. Customer-facing touchpoints ⚠️ PROPOSED — REVISED 2026-05-05

### New page: `cash-tdr-customer.html`

⚠️ Public landing page, no auth required (signed token in URL). Mobile-first single-page layout:

- **Header:** TN Appliance branding, customer name (bill_to) from intake. If `is_rental`: "Diagnosis report for your rental at {address}".
- **Diagnosis block:** plain-English overall diagnosis text from the TDR header.
- **N failure cards stacked vertically** (one per `tdr_failure` row):
  - Per card: failure description, **"Tenant reported" badge** if `tenant_reported=true`, **"Found during diagnosis"** badge if false.
  - Each card shows the 4 options + **Skip option as a clearly-styled fifth choice** (e.g., outlined gray button labeled "Skip this repair — $0").
  - Tapping a button selects that option for that failure (UI updates immediately, no full page reload).
  - **Warranty jobs:** Skip option is hidden (UI gate, plus API enforcement per §6).
- **Running total at the bottom** updates live as the customer makes selections:
  - Lists each selected failure with its chosen option and price.
  - Shows the $50 credit applied (once, on the first We Install only).
  - Shows grand total.
  - "Confirm and pay" CTA enabled only when every failure has a non-pending choice.
- **Helper actions:** "I want to think about it" (saves partial state, sends a reminder later) and "I'm not interested" (records all failures as `skip` → terminal `all_skipped`).
- **Footer:** contact info, "questions? text us at 615-280-2949"

### Operating rules (shown on the page — LOCKED 2026-05-05 — Decision 4)

The TDR view page MUST display these operating rules to the customer before any "Confirm and pay" action:

- **Pre-work labor adjustment.** "If when our technician arrives, the actual labor turns out to be different from your quote, they will tell you the new price BEFORE starting any work. You can accept the new price or have your unopened part returned (if applicable). Once work begins, the agreed price is final."
- **Part returns.** Unopened parts can be returned. Opened parts are non-returnable.
- **No mid-job adjustments.** Once work begins, the agreed price is final.

### SMS templates (mirrors Tier 1 customer message templates from `ant-tech-assist-design-v1.md`)

| Template | Recipient | Body |
|---|---|---|
| `qc_diagnosis_ready` | bill_to (standard) | hi {preferred_name} - your diagnosis from tn appliance is ready. here's what we found and your options: {link} |
| `qc_diagnosis_ready_rental` | bill_to (landlord) | tn appliance diagnosis for your rental at {address}. tenant reported: {tenant_symptoms}. we found {failure_count} issue(s). repair quote: {link} |
| `qc_diagnosis_fyi_tenant` | on_site_contact (tenant, optional — see §16 q3) | hi {tenant_preferred_name} - tn appliance finished diagnosing the {appliance}. your landlord is reviewing the repair quote and will let you know next steps. |
| `qc_choice_received` | bill_to | got it {preferred_name} - you picked options for {chosen_count} of {total_count} repair(s). {next_step_blurb} |
| `qc_payment_received` | bill_to | thanks {preferred_name} - payment confirmed. {fulfillment_next_step} |
| `qc_choice_reminder_24h` | bill_to | hi {preferred_name} - your tn appliance diagnosis is still waiting for your picks. {link} |
| `qc_choice_reminder_72h` | bill_to | hi {preferred_name} - last reminder on your tn appliance diagnosis. if you don't need to fix this anymore, no problem - just text STOP and we'll close it out. otherwise: {link} |
| `qc_fulfillment_tenant` | on_site_contact (rental only) | hi {tenant_preferred_name} - tn appliance is scheduled to come fix your {appliance} on {date} between {time_window}. |

⚠️ Tone matches existing Customer Ant + Tech Ant templates: lowercase, casual, hyphens not em dashes.

---

## 10. Stripe integration ⚠️ PROPOSED

### Existing infrastructure (verify before extending)

⚠️ The repo already has `STRIPE_LINK_50`, `STRIPE_LINK_90`, `STRIPE_LINK_100` env vars (referenced in `send_payment_link_POST.xs`). Need to verify whether these are static checkout links or whether dynamic checkout sessions are already wired. The static-link approach won't carry per-job context (which option, what amount), so dynamic Stripe Checkout Sessions are likely needed for the option payments.

### Two payment moments per QC job

1. **$50 entry payment** — could continue using the existing static Stripe link (or a dynamic session per job, both work). On success, `qc_status` flips to `diagnosis_pending`.
2. **Option payment** — must be dynamic per job, with line items per chosen failure. Amount and description vary by which options the customer picked across all failures. Generated via Stripe API call when the customer confirms their full choice set.

### Webhook handling

⚠️ Proposed: a single `qc_stripe_webhook` endpoint that handles `payment_intent.succeeded` events. Reads metadata to determine which payment moment (the metadata field `purpose` distinguishes `qc_diagnosis_50` from `option_payment`). For option payments, also reads metadata to mark which `tdr_failure` rows that payment covers. Updates `stripe_payment_intent` row, flips `qc_status`.

### Refund policy

⚠️ Proposed:
- $50 refund only if Teddy can't compose a diagnosis (rare — refund manually via Stripe dashboard)
- Option-payment refund only if customer cancels before fulfillment starts
- Once parts ship or tech rolls, refunds are case-by-case manual
- Per-failure refunds (customer cancels one repair after paying for multiple): manual case-by-case in v1

---

## 11. Parts sourcing ⚠️ PROPOSED

| Part type | Where the number comes from | Who places the order | Latency target |
|---|---|---|---|
| OEM | Teddy's manual lookup using model + symptom | v1: Danielle, manually placing the order with the wholesaler. v2: automated wholesaler API (out of v1 scope). | 1-3 business days |
| Amazon equivalent | Teddy's manual lookup on Amazon | v1: Danielle, ordering from Amazon Business account, ships to bill_to address from intake | 1-3 business days |

⚠️ **Key question:** does Teddy or Danielle place the order? Inferring Teddy enters part number/price during diagnosis, Danielle handles physical fulfillment. Confirm this division of labor.

⚠️ v1 manual parts handling is acceptable because volume is low; doesn't block the rest of the pipeline. Automation in v2.

⚠️ Multi-failure orders: when a customer picks multiple DIY paths, Danielle places multiple part orders, all shipping to the same bill_to address. Bundled shipment vs separate is at Danielle's discretion in v1.

---

## 12. Failure modes + observability ⚠️ PROPOSED — REVISED 2026-05-05

| Failure | Detection | Response |
|---|---|---|
| Customer paid $50 but Teddy hasn't composed within 4 business hours | `qc_compose_reminder` cron, 15-min cadence | SMS Teddy (escalation, not a customer-facing alert) |
| Customer hasn't chosen within 24 hours of `diagnosis_sent` | `qc_choice_reminder` cron, 1-hr cadence | Send `qc_choice_reminder_24h` SMS template |
| Customer hasn't chosen within 72 hours | same cron | Send `qc_choice_reminder_72h` SMS template, then auto-mark `abandoned` after 7 days |
| Customer made some failure choices but not all (`partial_chosen` state) | `qc_choice_reminder` cron checks for jobs with any `tdr_failure.selected_option = pending` past 48 hours | SMS `qc_choice_reminder_24h` template, then `_72h` |
| Option payment fails | Stripe webhook with `payment_intent.payment_failed` | SMS customer with retry link, escalate to Danielle if 2 retries fail |
| Part unavailable (manual order can't be filled) | Danielle flags in some operational system (TBD) | Manual: Danielle SMS customer with alternative or refund |
| Customer pays for We Install but no tech available in cluster | Existing scheduler escalation flow | Existing path — book next available, SMS customer |
| Repair fails post-shipment (DIY) or post-install (We Install) | Customer feedback SMS chain | Existing feedback handling — escalate negative feedback to Teddy/Danielle |
| **Landlord and tenant disagree** on which failures matter | Operational, not detectable in code | Escalate to Danielle. Open question: see §16 q1 |
| **Landlord declines all repairs but tenant escalates** | `qc_status = all_skipped` AND tenant calls in | Manual escalation to Teddy/Danielle. Possible Tier 3 customer-messaging case |
| **Customer DIYs a failure incorrectly**, tech discovers during install of OTHER failure that DIY part was wrong/installed wrong | Tech notices on-site, files in HCP note | Existing tech-escalation flow. Liability question — see §16 q4 |
| **Tech finds actual labor differs from Teddy's estimate** at the property (per Decision 4 operating rule) | Tech assesses on arrival, BEFORE starting work | Tech states the new price to customer per §3 operating rule. Customer accepts new price OR returns unopened part. If accepted: tech updates `tdr_failure.estimated_labor_price_cents` to actual; customer confirmation captured (mechanism per §16 q17); Stripe rebills via `payment_intent.modify` for unsettled charges or a new payment intent for the delta. Tech does NOT start work until customer agrees. |

### Audit trail

⚠️ Every state transition on `qc_status` AND `tdr_failure.selected_option` should write to `event_log` with action like `qc_status_changed_to_<state>` or `failure_option_selected` and metadata containing `{job_id, tdr_failure_id, prior_status, new_status, trigger}`. Mirrors the auditability pattern in HCP webhook handler.

---

## 13. Out of scope

This pipeline does NOT cover:

- **Warranty path** — separate inbound pipeline (`docs/inbound-pipeline-design-v1.md`). Multi-failure handling for warranty jobs DOES use the `tdr_failure` schema added here, but the choice/skip UI and pricing flow do not apply.
- **In-person estimate-only** offerings (no $50 prepaid diagnosis)
- **Live tech-on-phone consultation** before diagnosis (out of v1)
- **Subscription / repeat customer pricing** (out of v1)
- **Multi-appliance jobs** — one diagnosis = one appliance. Customer with two broken appliances gets two intakes / two QCs. (Multi-FAILURE on one appliance IS in scope per §4 — distinct from multi-appliance.)
- **Customer counter-offers / negotiation** outside the four options + Skip — manual escalation only
- **Per-region or per-cluster pricing variations** — single global pricing model in v1

---

## 14. Phasing ⚠️ PROPOSED — REVISED 2026-05-05

| Phase | Scope | Estimated sessions |
|---|---|---|
| 1a | Schema additions (`qc_status`, `qc_diagnosis_offer` table, `stripe_payment_intent` table, `bill_to_customer_id` / `on_site_contact_id` / `is_rental` on jobs). Teddy Tool extensions: add part-number + price + labor inputs alongside existing diagnosis field. `compose_qc_diagnosis` endpoint (single-failure version for now). | 2 |
| 1b | Customer-facing diagnosis page (`cash-tdr-customer.html`) — single-failure version. `qc_diagnosis_view` + `qc_customer_choice` endpoints. SMS templates. `send_qc_diagnosis_to_customer`. | 2 |
| 1c | Stripe integration: dynamic Checkout Sessions for option payments. `qc_stripe_webhook` for both $50 and option payments. **QC token signing on Netlify gateway** (mirrors HCP webhook architecture — XanoScript has no native HMAC primitive). Two Netlify Functions: `generate-qc-token.js` called by SMS send flow to mint URLs, and `validate-qc-token.js` called by Xano `qc_diagnosis_view` via `api.request` with internal-auth header. New env var `QC_TOKEN_SECRET` lives on Netlify side only. Replaces the Phase 1b stub that accepts any non-empty token. | 1-2 |
| 1d | Reminder crons (`qc_compose_reminder`, `qc_choice_reminder`). Audit-trail event_log writes for state transitions. | 1 |
| 1e | End-to-end live test with Teddy + Danielle on a real customer (or synthetic) — single-failure baseline. Soft-launch behind `CASH_TDR_DELIVERY_ENABLED` env flag. | 1 |
| **1f** | **Multi-failure UI + tdr_failure table.** Schema migration (additive, backfill one tdr_failure row per existing TDR). Teddy Tool: per-failure entry form (add/remove failures, per-failure pricing). Customer page: N failure cards + Skip option + running total. compose_qc_diagnosis revised to write multiple tdr_failure rows. State-machine aggregation logic. Warranty-mode Skip suppression. | 2-3 |
| **1g** | **Rental / bill_to flow.** is_rental flag wired into Customer Ant intake (capture landlord + tenant as separate customer rows). Rental SMS template variant. send_qc_diagnosis_to_customer routes by is_rental. Optional tenant FYI SMS. Decision-authority gating in signed token (tenant cannot pick options). Fulfillment SMS routes to both bill_to and on_site_contact. | 1-2 |
| 2 | Automated parts sourcing (wholesaler API + Amazon Business API). Out of v1. | TBD |

⚠️ Total v1: 9-12 sessions / ~30-40 active hours. Up from 7-9 sessions in pre-revision estimate due to multi-failure + rental complexity (Phases 1f and 1g added).

---

## 15. Operational handoff ⚠️ PROPOSED

| Responsibility | Owner |
|---|---|
| Compose diagnosis + enter pricing in Teddy Tool | Teddy |
| Order parts manually (v1) | Danielle |
| Customer support / refunds / non-standard requests | Danielle, with Teddy escalation |
| Scheduler / tech dispatch (We Install paths) | Existing flow (Tech Scheduler v2) |
| Customer-facing landing page errors / 500s | Engineering — SMS alert to Teddy if `qc_diagnosis_view` 5xx rate spikes |
| Pricing rule changes (labor estimate baseline, $50 credit policy) | Teddy, manual env-var or table update |
| Stripe webhook health | Engineering — alert on missed webhook delivery |
| Landlord-tenant disputes (rental scenario) | Danielle, with Teddy escalation |
| Pre-work labor confirmation (tech states new price if it differs, customer agrees before work starts — Decision 4) | Tech (on-site), with system support per §16 q17 |

---

## 16. Open questions

### Resolved 2026-05-05

- **Q2 RESOLVED — Decision 1:** `qc_status` is a separate column from `scheduling_status`. `scheduling_status` is extended with 4 new shared values (`intake_complete`, `prediagnosis_pending`, `needs_more_info`, `no_fix_possible`) used by both cash and warranty. `qc_status` carries cash-specific commercial states only (NULL for warranty). Cash jobs get queue priority in `prediagnosis_pending`. See §6.
- **Q3 RESOLVED — Decision 2:** Extend `technician_decision_report` with customer-facing fields (`customer_facing_diagnosis`, `public_view_token`, `sent_to_customer_at`, `viewed_at`, `expires_at`, `labor_credit_cents`). The proposed `qc_diagnosis_offer` table is removed. Internal-vs-customer-facing distinction lives at the API layer, not the schema layer. See §7.
- **Q16 RESOLVED — Decision 3:** Labor pricing is judgment-driven, not formula-driven. Teddy enters per-failure labor estimates using domain knowledge (first-repair full vs incremental). No `first_failure / additional_failure` columns or formulas. `tdr_failure.estimated_labor_price_cents` stays as the single per-failure column. See §3.

The original entries for Q2, Q3, Q16 below are kept for cross-reference; ignore them in favor of the resolutions above.

### Locked policies added 2026-05-05 (post-Phase-1b)

**TDR delivery SLA — 2 business hours after $50 payment.** Teddy's pre-diagnosis turnaround commitment. Window starts when the Stripe webhook fires `qc_diagnosis_paid_at`; ends when `send_qc_diagnosis_to_customer` fires the SMS. Surface this commitment in every customer touchpoint that mentions Quick Check timing:

- Customer Ant chat (during intake, when explaining what the $50 buys)
- Stripe confirmation page after the $50 payment lands
- Customer-facing TDR delivery SMS template (Phase 1c `send_qc_diagnosis_to_customer`)
- Marketing materials for the Quick Check (truck wraps, website, ad copy)

Distinct from post-selection SLAs (DIY parts ship 1-3 days; We Install scheduled within 2 business hours of Confirm and Pay — see §9 customer-facing alert). Definition of "business hours" is open — see q18.

### Still open

1. **Pricing display math.** §3's "We Install It (OEM)" shows `$495 ($215 labor + $280 part − $50 credit)`. Literal math: `215 + 280 = 495`, then minus `50` = `$445`. Does the customer see `$495` (subtotal before credit, with credit shown as a line item) or `$445` (post-credit total)? Same question for Amazon: `$310` displayed but `$310 − $50 = $260`. Need explicit policy on display vs internal math. *(Note: §3 table now shows post-credit totals as of 2026-05-05; this question is about display convention going forward.)*
2. ~~**`qc_status` co-existence with `scheduling_status`.**~~ **RESOLVED 2026-05-05 — Decision 1.** See "Resolved" subsection above.
3. ~~**`qc_diagnosis_offer` separate table vs extending `technician_decision_report`.**~~ **RESOLVED 2026-05-05 — Decision 2.** See "Resolved" subsection above.
4. **SMS vs email** for customer-facing notifications. Default SMS based on platform convention; email as fallback if customer didn't consent to SMS at intake. Confirm.
5. **Choice timeout duration.** Proposed 24hr first reminder, 72hr second, auto-abandon at 7 days. Are those right for QC customers' decision-making cadence?
6. **Multi-appliance during intake.** If customer brings up a second appliance during the chat, current flow can't handle it. Does intake gate to one appliance per job, or do we add a "multiple appliances" branch?
7. **Auto-equiv Amazon lookup vs Teddy manual.** Teddy entering OEM and Amazon part numbers per failure is friction (and now multiplied by failure count). Is there a Teddy Tool feature where given OEM + appliance, the tool suggests an Amazon equivalent? Out of v1 either way, but worth flagging for v2.
8. **$50 credit expiry.** Does the credit expire if the customer doesn't choose within N days? Affects abandoned-state semantics.
9. **Refund policy in edge cases.** Customer paid $50, got diagnosis, chose, paid second payment, then asks for refund within Stripe's chargeback window — what's the policy? Per-state explicit policy needed. Also: per-failure refunds when customer paid for multiple repairs but cancels one.
10. **Existing `STRIPE_LINK_50/90/100` env vars** — are these static Checkout links, dynamic session URLs, or template URLs with merge fields? Read `send_payment_link_POST.xs` before extending.
11. **Teddy Tool location for QC pricing inputs.** The current Teddy Tool form (`teddy-tdr-tool.html`) already has OEM + Amazon part + price + labor inputs collected client-side (per the `saveReviewInputs()` we inspected today). They're sent in the `submitTDR` payload but currently ignored by `create_tdr_POST.xs`. Are these the same fields or do we need new ones?

### New questions added 2026-05-05 (multi-failure + rental revision)

12. **Landlord/tenant disagreement on critical failures.** If the landlord declines a tenant-reported failure (e.g., tenant says "won't heat", landlord skips the repair), what's the policy? Auto-escalate to Danielle? Block the skip in the UI? Just record and move on? Affects rental-relationship liability.
13. **Decision authority for rentals: landlord email + tenant phone, or one contact sufficient?** Currently proposing both (bill_to gets decision SMS, tenant gets FYI), but this might be overkill or insufficient depending on the property arrangement.
14. **Tenant copy of TDR.** Does the on-site tenant get a copy of the TDR (FYI), or is it strictly bill_to-only? Privacy implications (rent info, repair history) vs operational clarity (tenant needs to know what's happening in their home).
15. **DIY-gone-wrong liability.** If customer DIYs incorrectly and damages further, what's our policy? Refund the part? No refund? Charge them for additional damage diagnosis? Partial credit on a follow-up We Install? Need explicit policy before exposing the DIY paths.
16. ~~**Pricing per failure: bundled vs per-failure labor.**~~ **RESOLVED 2026-05-05 — Decision 3.** See "Resolved" subsection above.

### New questions added 2026-05-05 (Decision 4 follow-up)

17. **Operational SOP for documenting pre-work labor adjustment.** When the tech updates the labor price on-site (per Decision 4), the workflow needs a defined SOP: how does the tech update `tdr_failure.estimated_labor_price_cents` — mobile UI? HCP note that gets parsed? Verbal-then-Danielle-records? How does the customer confirm — digital signature, SMS reply, or verbal recorded in tech notes? How does Stripe rebill — `payment_intent.modify` for unsettled charges, or a new payment intent for the delta? This blocks the operational rollout of Decision 4.

### New questions added 2026-05-05 (TDR SLA follow-up)

18. **"Business hours" definition for the 2-hour TDR delivery SLA.** The locked policy commits to "2 business hours" but doesn't define what counts. Tennessee timezone 8am-5pm Mon-Fri only? Saturday hours? US federal holidays excluded? Late-evening intakes — does the clock start on receipt or at next-business-day open? Pick a definition before Phase 1c surfaces this language to customers (Customer Ant intake script, Stripe confirmation page, send-TDR SMS template, marketing). Soft-default proposal: 8am-6pm Central Mon-Fri excluding US federal holidays; weekend/after-hours intakes start the clock at next business open.

Each open question has an explicit forcing function (review by Teddy + Danielle, code inspection, customer-cohort observation) that collapses it before commit. None blocks scoping.

---

## Notes for v2

⚠️ Items deliberately deferred:
- Automated parts sourcing (wholesaler API + Amazon Business API)
- Per-cluster or per-region pricing
- Subscription / repeat-customer flows
- Multi-appliance bundling
- Live-tech-on-phone pre-diagnosis option
- Self-service diagnosis edits by Teddy after customer received link (currently: send-once)
- Auto-equivalent Amazon part lookup (reduce Teddy's per-failure entry friction)
- Schema-driven warranty company support beyond AHS + SquareTrade

These are all extensions to the v1 productized triage model, not changes to it.
