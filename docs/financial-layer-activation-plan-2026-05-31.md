# Financial + Lifecycle Layer — Activation Plan

**Date:** 2026-05-31 (evening)
**Author:** Claude Code for Teddy
**Context:** Reconciliation between the 5/15 locked design (`docs/financial-system-design-2026-05-15.md`) and what's actually been built. Outputs an ordered activation sequence so the financial + lifecycle layer comes online during the aggressive HCP-kill week (6/1-6/6).

---

## 1 · TL;DR

We have a LOT of code (financial endpoints, BI agents, Stripe stack, dashboards) AND a LOT of planning (5/15 financial design, 5/20 automation inventory, 5/23 warranty strategy). They don't match.

**The 5/15 design was never fully implemented as spec'd.** What got built was ad-hoc with different names. Net: the financial layer has all the *pieces* but they're not wired into a coherent system. The fix is wiring + activation, not a rebuild.

This doc maps:
- Each lifecycle stage → existing code → wiring status
- Activation sequence ordered for the 6/1-6/6 HCP-kill week
- The 3 truly-missing pieces (refund handling, vent channel, vendor portal automation) — designs in companion docs

---

## 2 · Job lifecycle ↔ existing code

| # | Lifecycle stage | Existing code | Wiring status | Action |
|---|---|---|---|---|
| 1 | Email → job creation | AHS/SP/web-chat XS intakes ✅; `create_job_from_email` post-paste auto-enqueues | LIVE | Activate broadcast vs auto-schedule decision (Tue) |
| 2 | Pre-diagnosis request SMS | `job_created.js` agent ✅; `daily_job_prep.js` 6:30am ✅ | LIVE | None |
| 3 | Pre-diagnosis content | Teddy Tool (`teddy-tdr-tool.html`) | LIVE manual | Parts API integration when Marcone/Triple S deliver |
| 4 | Parts ordered before arrival | `parts_decision_aggregator` + `parts_lookup_*` agents; `parts_status` enum | LIVE for tracking; ordering manual | API integration when vendors deliver |
| 5 | Waiver sent + signed | `waiver_due.js` 4h pre-appt ✅; Jotform webhook ✅ | LIVE | Add server-side gate at tech-side: if `waiver_signed=false` show banner "have customer sign first" before Start Job |
| 6 | Job scheduled | Practice cron auto-schedules ✅; manual via `needs-scheduled.html` ✅; calendar ✅; `APPOINTMENT_SCHEDULED` chain → tech SMS + customer SMS (gated) ✅ | LIVE | Drop PRACTICE tag (Mon mid-day) |
| 7 | Customer pre-arrival comms | 24h reminder, 30-min check, ETA-on-OTW, arrival-on-Start ✅ | LIVE gated | `CUSTOMER_FACING_ENABLED=true` flips them (Tue) |
| 8 | Tech does the job | tech-ant-chat + FINISH overlay + 4 routes + 5-field TDR ✅; server-side TDR completeness gate (warranty + repair_complete) ✅ | LIVE | None |
| 9 | Outcome routing | Job Complete → Needs Invoiced; Parts Needed → awaiting_parts + `parts_arrival_check` 11am; Reassignment → needs_scheduled; No Fix → no_fix_possible ✅ | LIVE | Auto-schedule the revisit when parts arrive (NEW — small wire) |
| 10 | Warranty submission (digest) | `warranty_claim_action.js` composes claim package; SMS to Danielle ✅ | LIVE | None for digest |
| 10b | **Warranty portal submission (the actual entry)** | None | 🔴 MISSING | See `docs/warranty-portal-automation-scoping-2026-05-31.md` |
| 11 | Invoice generation (self-pay) | `netlify/functions/customer-invoice.js` ✅ EXISTS | 🟡 NOT WIRED | Wire to `JOB_COMPLETED` chain — auto-fire on Job Complete + self_pay |
| 12 | Auto-charge self-pay | `create-stripe-payment-link.js` ✅; `stripe_payment_link_due.js` agent ✅; Stripe webhook live | 🟡 WIRED FOR LINK, no card-on-file flow | Add Stripe Customer Portal flow for card-on-file capture during intake (Wed) |
| 13 | "How'd we do" SMS (24h post-completion) | `followup_due.js` ✅; feedback webhook captures 1-5 + ISSUE ✅ | LIVE | None |
| 14 | Positive → Google review | `google_review_request.js` ✅ (7d after OR immediately on 4-5 rating); 60-day dedup | LIVE | Verify the Google Business Profile URL is current |
| 15 | Negative → vent channel | URGENT internal SMS to Teddy + Danielle ✅; customer-facing vent: NONE | 🔴 MISSING customer side | See `docs/customer-vent-channel-design-2026-05-31.md` |
| 16 | Payment tracking (warranty) | `warranty_reimbursement_lag` agent BUILT DORMANT | 🟡 DORMANT | Activate by env-flag (see §3) |
| 17 | Payment tracking (self-pay) | `record_payment_received` ✅; `unpaid_self_pay_digest` 10:30am ✅; AR aging endpoint ✅ | LIVE | None |
| 18 | Tech payout (commission calc) | `payroll_calculator.js` agent ✅; `commission_rules.json` ✅ | LIVE via colony loop runtime calc | Wire `tech_earnings.commission_earned` write-back so other consumers see real values (per flag #2) |
| 19 | Tech payout (actual ACH) | `payout_batch_POST.xs` ✅; `payroll.html` ✅; `tech-payouts.html` ✅ | LIVE — manual ACH execution | Add "Run Payout Batch" button on financial-dashboard (per flag #6) |
| 20 | Refund handling | None | 🔴 MISSING | See `docs/refund-handling-design-2026-05-31.md` |
| 21 | Reschedule requests | RESCHEDULE keyword captured; routes through V007 SMS responder | LIVE for capture; resolution still office | Smart-escalation: structured A/B/C reply SMS to Teddy (per office-simplification plan) |
| 22 | Cancellation | `cancel_job_POST` + `cancel_followup.js` ✅ | LIVE | None |
| 23 | No-show | `no_show_check.js` 4h after Start ✅ | LIVE | None |
| 24 | Callback risk | `callback_check.js` 30d, `repeat_visit_check.js` 12mo ✅ | LIVE | None |
| 25 | Maintenance reminder | `maintenance_reminder.js` (6mo, 1yr) ✅ | LIVE | None |
| 26 | Reactivation campaign | `reactivation_campaign.js` weekly ✅ | LIVE | None |

---

## 3 · 5/15 design ↔ what was actually built (reconciliation)

The 5/15 design specified a tight financial sub-system with 6 tables + 10 endpoints. Here's what landed:

### Tables (planned vs built)

| Designed | Built? | Notes |
|---|---|---|
| `warranty_vendor_accounts` | ❓ unknown — not in repo schemas dump | Need to verify in Xano UI |
| `warranty_payment_batches` | ❓ unknown | Same |
| `warranty_payment_lines` | ❓ unknown | Same |
| `tech_payroll_periods` | ❓ unknown | Same — but `payout_batch_POST` exists which implies SOME batch table |
| `tech_payroll_lines` | ❓ unknown | Same |
| `job_financial` extensions | ✅ exists (table id confirmed) | Per inventory |
| `technicians.commission_rate` column | ❌ not used — rules in `commission_rules.json` instead | Per flag #1 |

### Endpoints (planned vs built)

| Designed | Built? | Notes |
|---|---|---|
| `squaretrade_payment_intake_POST` | 🟡 referenced in inventory at `api/financial/` but **not in current repo** | Lost or never committed |
| `ahs_payment_intake_POST` | 🟡 same — referenced but not in repo | Same |
| `nsa_payment_intake_POST` | ❌ | |
| `manual_payment_entry_POST` | ❌ | |
| `get_payroll_report_GET` | ❌ | But `payout_batch_POST` exists |
| `approve_payroll_POST` | ❌ | |
| `resolve_dispute_POST` | ❌ | |
| `get_financial_dashboard_GET` | 🟡 `financial-dashboard.html` exists but backend unclear | |
| `get_job_financial_summary_GET` | 🟡 `job_financials_GET.xs` exists | Different name |
| `parts_markup_calc_GET` | ❌ | |

**What's there instead:** `record_payment_received`, `send_payment_link`, `backfill_commission_from_payment`, `generate_1099_summary`, `payout_batch`. None of these match the design's naming or shape.

**Interpretation:** the 5/15 design represented an aspirational architecture. Real construction veered toward simpler ad-hoc endpoints driven by immediate operational needs. We have FUNCTIONAL replacements but not the integrated payment-batch reconciliation system the design called for.

**Implication for HCP cut:** the design's batch reconciliation (parse remittance email → match to jobs → calculate commission → approve payroll) **is not implemented**. Today, when an AHS / ServicePower payment hits the bank, Teddy and Danielle do the matching manually. Killing HCP doesn't change this. The financial reconciliation gap survives the cut — it's a separate workstream.

---

## 4 · Activation sequence for HCP-kill week (6/1-6/6)

Ordered by leverage / risk:

### MON 6/1 — practice + auto-schedule baseline

- [x] Practice cron running (done)
- [x] Tech FINISH overlay verified (done)
- [x] Office dashboard buckets live (done)
- [ ] Mid-day: drop the `PRACTICE_` prefix on new auto-schedules (small mock-scheduler edit)
- [ ] **Activate `parts_arrival_check` autoschedule** — current state: alerts customer when parts ETA passes. Extend: if customer responds, auto-call practice/auto-schedule for the revisit slot.

### TUE 6/2 — customer gate + invoice wiring

- [ ] Flip `CUSTOMER_FACING_ENABLED=true` (parallel-mode jobs only — blast-radius gate via XS check on `parallel_mode==true`)
- [ ] **Wire `customer-invoice.js` to `JOB_COMPLETED` chain** for self-pay jobs. Currently the function exists but nothing calls it. Add a hook in `tech_job_complete_POST.xs` or as a separate `customer_invoice_due.js` agent listening for JOB_COMPLETED + customer_type=self_pay.
- [ ] **Verify Google Business Profile URL** in `google_review_request.js` is current (TNAE's actual GBP URL)

### WED 6/3 — vent channel + waiver gate

- [ ] **Ship customer vent channel** (1-2 star feedback URL) — see `customer-vent-channel-design-2026-05-31.md`
- [ ] **Server-side waiver gate** in tech-ant-chat: before Start Job, check `waiver_signed`; if false, show banner asking tech to have customer sign first.
- [ ] **Activate dormant BI agents** (env-flag flip + verify):
  - `parts_business_intel_daily_revenue_tracker` (daily 6pm EOD)
  - `market_business_intel_cash_position_watcher`
  - `market_business_intel_ar_aging_reporter`
  - `market_business_intel_warranty_reimbursement_lag`

### THU 6/4 — refund workflow + smart-escalation SMS

- [ ] **Ship refund handling endpoint + flow** — see `refund-handling-design-2026-05-31.md`
- [ ] Convert `RESCHEDULE` and similar customer-Q routes from "alert Danielle" to "structured A/B/C SMS to Teddy" — per office-simplification plan Phase 3.

### FRI 6/5 — parity audit + cut prep

- [ ] Build parity dashboard: today's Ant jobs vs HCP jobs side-by-side; lifecycle event coverage gauge.
- [ ] Run HCP migration import dry-run: `node colony-loop/scripts/hcp-migration-import.js --dry-run --max=100`
- [ ] Verify all Phase 5A warranty digest SMSes are firing to Danielle on test completions

### SAT 6/6 — HCP cut day

Follow `docs/hcp-cutover-playbook-2026-05-27.md` Day 3 sequence. Add to the runbook:
- Activate practice-real auto-schedule for ALL incoming jobs (no more practice tag)
- Flip `HCP_PUSH_DISABLED=true` (XS-side)
- Disable `hcp_poll_recent_jobs` Xano scheduled task
- Run migration import live (no `--dry-run`)
- Monitor 24h

---

## 5 · Activation env-flag matrix

For the dormant BI agents and other gated paths:

| Env var | Current | Target | Effect |
|---|---|---|---|
| `CUSTOMER_FACING_ENABLED` | false | true (Tue) | Customer SMS unlocked |
| `LEDGER_TASK_ENABLED` | unset | true (Wed, after `commission_earned` fix) | Nightly perf ledger compute |
| `SCHEDULING_QUEUE_ENABLED` | true | true | Already on; worker still runs |
| `DAILY_SUMMARY_ENABLED` | unset | true (Wed) | Per-tech morning rundown SMS |
| `HCP_PUSH_DISABLED` | true | true | Stays on |
| `HCP_WEBHOOK_DISABLED` | true | true | Stays on |
| `EMAIL_INTAKE_ENABLED` | true | true | Stays on |
| `PARSER_ACTIVATION_TS_MS` | set | set | Stays |

---

## 6 · Three truly-missing designs (companion docs)

These are NOT in any existing design doc. New designs in:
- `docs/refund-handling-design-2026-05-31.md`
- `docs/customer-vent-channel-design-2026-05-31.md`
- `docs/warranty-portal-automation-scoping-2026-05-31.md`

---

## 7 · Risk register

| Risk | Mitigation |
|---|---|
| `tech_earnings.commission_earned` always $0 (flag #2) | Colony loop runtime calc bypasses; fix before activating `LEDGER_TASK_ENABLED` (Wed) |
| 5/15 reconciliation gap (no batch payment matching) | Survives the cut. Manual matching by Teddy + Danielle continues until vendor portal automation lands. NOT a cut-blocker. |
| Warranty portal manual entry | Biggest single Danielle-replacement lever. Scope this Wed; build Thu-Fri or following week. NOT a cut-blocker but accelerates simplification. |
| Stripe key rotation pending (flag #4) | Rotate via Stripe dashboard before Tue customer-gate flip. |
| Refund handling unbuilt | Low frequency event; Thu sprint lands the minimal version. |
| LA tax = manual per parish (design §4) | Survives the cut. Self-pay LA jobs flagged for manual rate entry. |

---

## 8 · What's out of scope here

- LA parish tax lookup (design §12)
- AHS 3rd LA vendor number (flag follow-up)
- Migration of Meistertask historical records (design §12)
- External bookkeeper data export (design §12)
- Lead-gen / marketing automation (`reactivation_campaign` exists but is a different track)

---

## Index

- §2 lifecycle ↔ code
- §3 5/15 design ↔ reality reconciliation
- §4 6/1-6/6 activation sequence
- §5 env-flag matrix
- §6 missing designs (companion docs)
- §7 risk register
