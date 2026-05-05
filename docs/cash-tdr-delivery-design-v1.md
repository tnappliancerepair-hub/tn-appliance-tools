# Cash Flow TDR Delivery — Design v1

**Status:** Scoping in progress. Sections 1-3 locked per Teddy's brief. Sections 4-15 are PROPOSED SHAPES — confirm or rewrite each before any build commitment.

**Last updated:** 2026-05-05

**Owner:** Teddy / James Pivacek

**Estimated build:** TBD pending review of proposed sections

> **⚠️ Speculative content flagged.** Sections 1-3 are verbatim from the scope brief. Sections 4-15 are proposed shapes synthesized from existing design docs (`inbound-pipeline-design-v1.md`, `gmail-integration-design-v1.md`, `ant-tech-assist-design-v1.md`) and the cash-flow-TDR domain. Every proposed section has a ⚠️ marker; treat each as "draft, edit freely" until reviewed. Open questions in §15 are the real unknowns.

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

## 3. The four customer options

Each option has distinct pricing and commitment. **Example pricing only — actual numbers come from Teddy's diagnosis input per job.**

| Option | Price example | What customer gets | What we do |
|---|---|---|---|
| **DIY OEM Part** | $280 part + free shipping | Brand-name original part shipped | Send part, no labor |
| **DIY Amazon Equivalent** | $95 part + free shipping | Aftermarket equivalent shipped | Send part, no labor |
| **We Install It (OEM)** | $445 ($215 labor + $280 part − $50 credit) | OEM part + tech installs | Truck roll, install, complete repair |
| **We Install It (Amazon)** | $260 ($215 labor + $95 part − $50 credit) | Amazon part + tech installs | Truck roll, install, complete repair |

### Pricing rules (locked)

- The $50 already paid for diagnosis credits **ONLY** toward the "We Install It" labor cost.
- DIY paths get the part at full price — the $50 was the assessment fee, parts are separate.
- Pricing is per-job — Teddy enters labor estimate + OEM part number/price + Amazon equivalent number/price into Teddy Tool, the four options render automatically off those inputs.

---

## 4. End-to-end flow ⚠️ PROPOSED — confirm channels and trigger points

> Proposed actor-and-channel sequence. Built off the existing intake/Customer-Ant + HCP-integration + Teddy-Tool patterns. Channel choices (SMS vs email) and trigger mechanics (push vs pull) need confirmation.

```
1. INTAKE (free)
   Customer ↔ Customer Ant chat (web)
   → creates jobs row in Xano, qc_status="intake_complete"
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
6. TEDDY DIAGNOSES (Teddy Tool, existing UI extended)
   Reviews intake info + photos. Enters:
     - diagnosis text (already wired)
     - OEM part number + price
     - Amazon equivalent number + price
     - labor estimate
   Submit → compose_qc_diagnosis endpoint
   qc_status="diagnosis_sent"
   ↓
7. CUSTOMER NOTIFIED
   send_qc_diagnosis_to_customer fires SMS with signed link
   to a customer-facing diagnosis-and-options page
   qc_status="choice_pending"
   ↓
8. CUSTOMER CHOOSES
   Public page (cash-tdr-customer.html or similar) renders the
   diagnosis + four option cards. Customer taps one card.
   POST to qc_customer_choice endpoint
   qc_status="chose_diy_oem" | "chose_diy_amazon"
              | "chose_install_oem" | "chose_install_amazon"
              | "declined"
   ↓
9. FULFILLMENT BRANCHES
   ├── DIY paths → Stripe charge (full part price) →
   │   on payment success, manual or automated parts order →
   │   ship to customer's address from intake →
   │   tracking number SMS
   │   qc_status="fulfillment_complete"
   │
   └── We Install paths → Stripe charge (labor + part − $50 credit) →
       on payment success, HCP appointment booked →
       existing scheduler / tech dispatch flow →
       on HCP work_status=completed: feedback SMS chain
       qc_status="fulfillment_complete"
```

### Channels

⚠️ Proposed: SMS for all customer-facing touchpoints (mirrors the rest of the platform). Email as fallback if customer didn't consent to SMS at intake. Customer-facing diagnosis page is web (responsive, mobile-first).

### Triggers between handoffs

⚠️ Proposed:
- Stripe → Xano: webhook
- Xano → Teddy: SMS via existing `send_sms` endpoint, plus a Teddy Tool dashboard query that surfaces "diagnosis_pending" jobs
- Xano → Customer: SMS with signed-link URL (token in URL, validated by Xano on page load)
- Customer page → Xano: AJAX POST on choice click
- Xano → Stripe: API call to create checkout session for option-specific payment

---

## 5. State machine for the QC pipeline ⚠️ PROPOSED

> Proposed `qc_status` enum on the existing `jobs` table. Single column captures the pipeline state.

```
intake_complete
   │
   ▼
payment_link_sent
   │
   ▼
diagnosis_pending  ← (the $50 just landed)
   │
   ▼
diagnosis_sent     ← (Teddy composed, customer SMS sent)
   │
   ▼
choice_pending     ← (waiting for customer to click)
   │
   ├──→ chose_diy_oem
   ├──→ chose_diy_amazon
   ├──→ chose_install_oem
   ├──→ chose_install_amazon
   ├──→ declined          (customer explicitly opted out)
   ├──→ abandoned         (no choice within timeout — see §11)
   │
   ▼ (option_payment_pending if paid path)
fulfillment_in_progress
   │
   ▼
fulfillment_complete
```

Terminal states: `fulfillment_complete`, `declined`, `abandoned`, `refunded`. Each terminal state preserves all upstream state for audit.

⚠️ **Open question:** does this `qc_status` live alongside the existing `scheduling_status` on jobs (independent dimensions), or should they be unified? Need to walk the existing scheduling_status enum and see if there's overlap to avoid double-state.

---

## 6. Schema additions ⚠️ PROPOSED

### Extensions to existing `jobs` table

⚠️ Proposed new columns:

| Column | Type | Purpose |
|---|---|---|
| `qc_status` | enum (values listed in §5) | The pipeline state |
| `qc_diagnosis_paid_at` | timestamp, nullable | When the $50 came in via Stripe |
| `qc_diagnosis_sent_at` | timestamp, nullable | When the customer-facing diagnosis SMS fired |
| `qc_choice_made_at` | timestamp, nullable | When the customer picked an option |
| `qc_customer_choice` | enum (diy_oem, diy_amazon, install_oem, install_amazon, declined, abandoned) | Their pick |

### New table: `qc_diagnosis_offer` ⚠️ PROPOSED — see §15 alternative

⚠️ This table separates the **customer-facing** version of the diagnosis from the internal `technician_decision_report`. TDR is the tech's full audit record; this is the public/abridged version with pricing.

```
id (pk)
created_at
job_id (fk jobs)
tdr_id (fk technician_decision_report, nullable)
diagnosis_text (text)              — derived from TDR.diagnosis, sanitized for customer
oem_part_number (text)
oem_part_price_cents (int)
amazon_part_number (text)
amazon_part_price_cents (int)
labor_estimate_cents (int)
labor_credit_cents (int default 5000)  — the $50 already paid
status (enum: draft, sent, viewed, chosen, expired)
sent_at (timestamp, nullable)
viewed_at (timestamp, nullable)
chosen_at (timestamp, nullable)
public_view_token (text, indexed)  — signed token for SMS link
expires_at (timestamp, nullable)
```

### New table: `stripe_payment_intent` ⚠️ PROPOSED

⚠️ Tracks all Stripe charges for a job (the $50, plus the second option-specific charge). Could also be a column on jobs but a separate table allows for retries, refunds, and audit cleanly.

```
id (pk)
created_at
job_id (fk jobs)
stripe_payment_intent_id (text)
purpose (enum: qc_diagnosis_50, option_payment, refund)
amount_cents (int)
status (enum: created, succeeded, failed, refunded, canceled)
succeeded_at (timestamp, nullable)
metadata (json) — Stripe webhook payload audit
```

⚠️ **Open question:** does the existing job_financial table cover this? Need to inspect — it might already have payment_status fields suitable for extending.

---

## 7. New endpoints ⚠️ PROPOSED

| Endpoint | Method | Caller | Purpose |
|---|---|---|---|
| `compose_qc_diagnosis` | POST | Teddy Tool (extends existing `submitTDR`) | Creates the qc_diagnosis_offer row, computes prices, sets `qc_status="diagnosis_sent"` |
| `send_qc_diagnosis_to_customer` | POST | called inside `compose_qc_diagnosis` or as separate trigger | Generates signed token, sends SMS to customer with link |
| `qc_diagnosis_view` | GET | customer-facing page on load | Validates signed token, returns diagnosis + four options for the page to render |
| `qc_customer_choice` | POST | customer-facing page on click | Records the choice, generates the option-specific Stripe checkout session, returns checkout URL |
| `qc_stripe_webhook` | POST | Stripe | Handles `payment_intent.succeeded` for both the $50 and the option payment; flips `qc_status` accordingly |
| `qc_compose_reminder` | POST | cron task (15 min) | Finds `diagnosis_pending` jobs older than N hours, SMS Teddy |
| `qc_choice_reminder` | POST | cron task (1 hr) | Finds `choice_pending` jobs older than N days, SMS customer |

### Tools the customer-facing page needs

⚠️ The signed token approach mirrors HCP webhook setup pattern. The token encodes job_id + qc_diagnosis_offer.id + expiry, signed by Xano with an env var secret. Page calls `qc_diagnosis_view?token=...` to fetch render data; same token used for `qc_customer_choice` POST.

---

## 8. Customer-facing touchpoints ⚠️ PROPOSED

### New page: `cash-tdr-customer.html`

⚠️ Public landing page, no auth required (signed token in URL). Mobile-first single-page layout:

- Header: TN Appliance branding, customer name from intake
- Diagnosis block: plain-English diagnosis text from the TDR
- Four option cards (stacked on mobile, 2x2 grid on desktop):
  - Each shows: option name, total price prominently, what's included, "I want this" button
  - Tapping a button POSTs to `qc_customer_choice` and redirects to Stripe checkout for paid options or a confirmation page for declined
- Below the cards: "I want to think about it" (saves choice as `pending`, sends a reminder later) and "I'm not interested" (records `declined`)
- Footer: contact info, "questions? text us at 615-280-2949"

### SMS templates (mirrors Tier 1 customer message templates from `ant-tech-assist-design-v1.md`)

| Template | Body |
|---|---|
| `qc_diagnosis_ready` | hi {preferred_name} - your diagnosis from tn appliance is ready. here's what we found and your options: {link} |
| `qc_choice_received` | got it {preferred_name} - you chose {option_label}. {next_step_blurb} |
| `qc_payment_received` | thanks {preferred_name} - payment confirmed for the {option_label}. {fulfillment_next_step} |
| `qc_choice_reminder_24h` | hi {preferred_name} - just a heads up, your diagnosis from tn appliance is still waiting for your pick. {link} |
| `qc_choice_reminder_72h` | hi {preferred_name} - last reminder on your diagnosis. if you don't need to fix this anymore, no problem - just text STOP and we'll close it out. otherwise: {link} |

⚠️ Tone matches existing Customer Ant + Tech Ant templates: lowercase, casual, hyphens not em dashes.

---

## 9. Stripe integration ⚠️ PROPOSED

### Existing infrastructure (verify before extending)

⚠️ The repo already has `STRIPE_LINK_50`, `STRIPE_LINK_90`, `STRIPE_LINK_100` env vars (referenced in `send_payment_link_POST.xs`). Need to verify whether these are static checkout links or whether dynamic checkout sessions are already wired. The static-link approach won't carry per-job context (which option, what amount), so dynamic Stripe Checkout Sessions are likely needed for the option payments.

### Two payment moments per QC job

1. **$50 entry payment** — could continue using the existing static Stripe link (or a dynamic session per job, both work). On success, `qc_status` flips to `diagnosis_pending`.
2. **Option payment** — must be dynamic per job. Amount and description vary by which option the customer picked. Generated via Stripe API call when `qc_customer_choice` fires.

### Webhook handling

⚠️ Proposed: a single `qc_stripe_webhook` endpoint that handles `payment_intent.succeeded` events. Reads metadata to determine which payment moment (the metadata field `purpose` distinguishes `qc_diagnosis_50` from `option_payment`). Updates `stripe_payment_intent` row, flips `qc_status`.

### Refund policy

⚠️ Proposed:
- $50 refund only if Teddy can't compose a diagnosis (rare — refund manually via Stripe dashboard)
- Option-payment refund only if customer cancels before fulfillment starts
- Once parts ship or tech rolls, refunds are case-by-case manual

---

## 10. Parts sourcing ⚠️ PROPOSED

| Part type | Where the number comes from | Who places the order | Latency target |
|---|---|---|---|
| OEM | Teddy's manual lookup using model + symptom | v1: Danielle, manually placing the order with the wholesaler. v2: automated wholesaler API (out of v1 scope). | 1-3 business days |
| Amazon equivalent | Teddy's manual lookup on Amazon | v1: Danielle, ordering from Amazon Business account, ships to customer address from intake | 1-3 business days |

⚠️ **Key question:** does Teddy or Danielle place the order? Inferring Teddy enters part number/price during diagnosis, Danielle handles physical fulfillment. Confirm this division of labor.

⚠️ v1 manual parts handling is acceptable because volume is low; doesn't block the rest of the pipeline. Automation in v2.

---

## 11. Failure modes + observability ⚠️ PROPOSED

| Failure | Detection | Response |
|---|---|---|
| Customer paid $50 but Teddy hasn't composed within 4 business hours | `qc_compose_reminder` cron, 15-min cadence | SMS Teddy (escalation, not a customer-facing alert) |
| Customer hasn't chosen within 24 hours of `diagnosis_sent` | `qc_choice_reminder` cron, 1-hr cadence | Send `qc_choice_reminder_24h` SMS template |
| Customer hasn't chosen within 72 hours | same cron | Send `qc_choice_reminder_72h` SMS template, then auto-mark `abandoned` after 7 days |
| Option payment fails | Stripe webhook with `payment_intent.payment_failed` | SMS customer with retry link, escalate to Danielle if 2 retries fail |
| Part unavailable (manual order can't be filled) | Danielle flags in some operational system (TBD) | Manual: Danielle SMS customer with alternative or refund |
| Customer pays for We Install but no tech available in cluster | Existing scheduler escalation flow | Existing path — book next available, SMS customer |
| Repair fails post-shipment (DIY) or post-install (We Install) | Customer feedback SMS chain | Existing feedback handling — escalate negative feedback to Teddy/Danielle |

### Audit trail

⚠️ Every state transition on `qc_status` should write to `event_log` with action like `qc_status_changed_to_<state>` and metadata containing `{job_id, prior_status, new_status, trigger}`. Mirrors the auditability pattern in HCP webhook handler.

---

## 12. Out of scope

This pipeline does NOT cover:

- **Warranty path** — separate inbound pipeline (`docs/inbound-pipeline-design-v1.md`)
- **In-person estimate-only** offerings (no $50 prepaid diagnosis)
- **Live tech-on-phone consultation** before diagnosis (out of v1)
- **Subscription / repeat customer pricing** (out of v1)
- **Multi-appliance jobs** — one diagnosis = one appliance. Customer with two broken appliances gets two intakes / two QCs.
- **Customer counter-offers / negotiation** outside the four options — manual escalation only
- **Per-region or per-cluster pricing variations** — single global pricing model in v1

---

## 13. Phasing ⚠️ PROPOSED

| Phase | Scope | Estimated sessions |
|---|---|---|
| 1a | Schema additions (`qc_status`, `qc_diagnosis_offer` table, `stripe_payment_intent` table). Teddy Tool extensions: add part-number + price + labor inputs alongside existing diagnosis field. `compose_qc_diagnosis` endpoint. | 2 |
| 1b | Customer-facing diagnosis page (`cash-tdr-customer.html`). `qc_diagnosis_view` + `qc_customer_choice` endpoints. SMS templates. `send_qc_diagnosis_to_customer`. | 2 |
| 1c | Stripe integration: dynamic Checkout Sessions for option payments. `qc_stripe_webhook` for both $50 and option payments. | 1-2 |
| 1d | Reminder crons (`qc_compose_reminder`, `qc_choice_reminder`). Audit-trail event_log writes for state transitions. | 1 |
| 1e | End-to-end live test with Teddy + Danielle on a real customer (or synthetic). Soft-launch behind `CASH_TDR_DELIVERY_ENABLED` env flag. | 1 |
| 2 | Automated parts sourcing (wholesaler API + Amazon Business API). Out of v1. | TBD |

⚠️ Total v1: 7-9 sessions / ~20-30 active hours.

---

## 14. Operational handoff ⚠️ PROPOSED

| Responsibility | Owner |
|---|---|
| Compose diagnosis + enter pricing in Teddy Tool | Teddy |
| Order parts manually (v1) | Danielle |
| Customer support / refunds / non-standard requests | Danielle, with Teddy escalation |
| Scheduler / tech dispatch (We Install paths) | Existing flow (Tech Scheduler v2) |
| Customer-facing landing page errors / 500s | Engineering — SMS alert to Teddy if `qc_diagnosis_view` 5xx rate spikes |
| Pricing rule changes (labor estimate baseline, $50 credit policy) | Teddy, manual env-var or table update |
| Stripe webhook health | Engineering — alert on missed webhook delivery |

---

## 15. Open questions

1. **Pricing display math.** §3's "We Install It (OEM)" shows `$495 ($215 labor + $280 part − $50 credit)`. Literal math: `215 + 280 = 495`, then minus `50` = `$445`. Does the customer see `$495` (subtotal before credit, with credit shown as a line item) or `$445` (post-credit total)? Same question for Amazon: `$310` displayed but `$310 − $50 = $260`. Need explicit policy on display vs internal math.
2. **`qc_status` co-existence with `scheduling_status`.** The existing `jobs.scheduling_status` enum has values like `pending`, `awaiting_parts`, `ready`, `broadcasting`, `scheduled`, `in_progress`, `completed`, `escalated`, `canceled`, `held`. Some overlap with proposed QC states. Should QC introduce a separate `qc_status` column (parallel dimensions) or extend `scheduling_status`?
3. **`qc_diagnosis_offer` separate table vs extending `technician_decision_report`.** Proposed §6 favors separation (audit vs public-facing). But extending TDR is simpler. Trade-off: clean conceptual separation vs schema simplicity. Pick one before Phase 1a.
4. **SMS vs email** for customer-facing notifications. Default SMS based on platform convention; email as fallback if customer didn't consent to SMS at intake. Confirm.
5. **Choice timeout duration.** Proposed 24hr first reminder, 72hr second, auto-abandon at 7 days. Are those right for QC customers' decision-making cadence?
6. **Multi-appliance during intake.** If customer brings up a second appliance during the chat, current flow can't handle it. Does intake gate to one appliance per job, or do we add a "multiple appliances" branch?
7. **Auto-equiv Amazon lookup vs Teddy manual.** Teddy entering OEM and Amazon part numbers per job is friction. Is there a Teddy Tool feature where given OEM + appliance, the tool suggests an Amazon equivalent? Out of v1 either way, but worth flagging for v2.
8. **$50 credit expiry.** Does the credit expire if the customer doesn't choose within N days? Affects abandoned-state semantics.
9. **Refund policy in edge cases.** Customer paid $50, got diagnosis, chose, paid second payment, then asks for refund within Stripe's chargeback window — what's the policy? Per-state explicit policy needed.
10. **Existing `STRIPE_LINK_50/90/100` env vars** — are these static Checkout links, dynamic session URLs, or template URLs with merge fields? Read `send_payment_link_POST.xs` before extending.
11. **Teddy Tool location for QC pricing inputs.** The current Teddy Tool form (`teddy-tdr-tool.html`) already has OEM + Amazon part + price + labor inputs collected client-side (per the `saveReviewInputs()` we inspected today). They're sent in the `submitTDR` payload but currently ignored by `create_tdr_POST.xs`. Are these the same fields or do we need new ones?

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

These are all extensions to the v1 productized triage model, not changes to it.
