# Office Process — Eliminate / Combine / Automate

**Date:** 2026-06-01
**Authors:** Teddy + Claude
**Status:** Strategic — the definitive map of what we build, in what order, and why.

This doc replaces "let's add buttons" with "let's redesign the workflow first." Every line below is a deliberate choice between **eliminate** (the step doesn't need to exist), **combine** (fold into another step), **automate** (remove the human), or **human-only** (keeps a person because judgment is required).

The goal: an office that runs with 2-3 hours of human work/day, max. Today Danielle is full-time slammed. The path to a Danielle-optional office runs through this doc.

---

## 1 · Full lifecycle (current vs target state)

The job lifecycle has 5 phases and 4 horizontal layers that cross every phase.

```
                                        ┌──── HORIZONTAL LAYERS ────┐
                                        │  ① Financial               │
[Phase 1: Intake & Schedule]            │  ② Communication           │
    ↓                                   │  ③ Voice (VAPI)            │
[Phase 2: Parts ordered & shipped]      │  ④ Audit / event_log       │
    ↓                                   └────────────────────────────┘
[Phase 3: Tech on-site → fix OR loop back]
    ↓
[Phase 4: Payment lands → matched to job]
    ↓
[Phase 5: Tech payout cycle]
```

### Phase 1 — Intake & Schedule

| Sub-step | Today | Target |
|---|---|---|
| Warranty dispatch email arrives | Office opens Gmail, sees it | Same — Gmail still receives |
| Pull email content into Ant | **Office manually copies into system OR poller catches it** | Poller catches it automatically (already running 15-min cron) |
| Job created at `not_ready` | Auto (intake endpoint) | Same — already happens |
| Customer contacted to gather info + availability | **Office calls/texts each customer one-by-one** | **Auto-fired customer SMS with intake-chat deep-link** — customer clicks, chats with Ant, intake captures details + availability |
| Job scheduled | **Office chooses tech + slot manually** | **System auto-schedules** based on cluster, capacity, customer prefs — broadcast to qualified techs OR direct-assign if confidence is high |

### Phase 2 — Parts ordered & shipped

| Sub-step | Today | Target |
|---|---|---|
| Pre-diagnosis | **Teddy types into Teddy Tool** | AI agent generates first draft from symptom + brand + model, Teddy confirms (eventually unattended) |
| Identify exact part | **Manual via Sears Parts Direct link** | Marcone / Triple S API auto-lookup (pending vendor delivery) |
| Order the part | **Manual via vendor portal** | API call (pending vendor delivery) — autonomous or confirm-and-fire |
| Ship to customer's address | **Manual order entry** | API includes shipping address (customer's, not warehouse) |
| Record parts cost / sell price / tax | **Not tracked today** | Auto-write to `job_financial` at order time |
| Customer SMS: "Parts on the way, ETA Jun 5" | **None today** | Comm agent fires automatically |
| Track shipment | **No tracking** | Vendor tracking # captured, ETA monitored, auto-alert on delays |

### Phase 3 — Tech on-site

| Sub-step | Today | Target |
|---|---|---|
| Tech opens job | Dashboard → tech-ant-chat | Same |
| NAV / OTW / CALL / START | Action bar buttons + voice intent router (just shipped) | Same |
| Diagnose + repair | Manual | Same — judgment task |
| FINISH tap | 4-button overlay (Job Complete / Parts Needed / Reassignment / Not Worth Fixing) | Same — pick outcome |
| **If FIXED** → TDR captured | Inline 5-field form | Same; field set may grow per-vendor (used parts vs returned parts for SquareTrade) |
| Job_financial finalized | **Not auto today** | Auto-write labor + commission + tax on FINISH |
| Vendor-specific submission package | **Danielle manually assembles + pastes into vendor portal** | Per-vendor adapter; Office Today shows paste-ready until adapter ships per-vendor |
| Self-pay invoice | **`customer-invoice.js` exists but isn't called from `tech_job_complete`** | Wire it — auto-fire on Job Complete + customer_type=self_pay |
| **If NOT FIXED** → loop back to Phase 2 | Tech notes parts needed; office re-orders | Same loop. Parts captured at FINISH feed straight into new order |
| Customer SMS: "Repair done, here's your invoice" / "Submitted to AHS for review" | **None today** | Comm agent fires |

### Phase 4 — Payment lands

| Sub-step | Today | Target |
|---|---|---|
| Warranty company EFT lands in bank | Office reconciles manually | Email remittance parser → `warranty_payment_lines` → match to job (per 5/15 financial design) |
| Match payment to specific job | **Manual** | Auto-match on claim_number / dispatch_id |
| Mark `job_financial.paid_date` | **Manual** | Auto on match |
| Self-pay Stripe webhook | Already live | Same |
| Disputed/short-paid handling | Manual | `resolve_dispute_POST` per 5/15 design |
| Customer SMS: "Payment received" | None | Comm agent fires (light touch — not always needed) |

### Phase 5 — Tech payout cycle

| Sub-step | Today | Target |
|---|---|---|
| Per-job commission calculated | Colony loop `payroll_calculator` agent (runtime calc; `tech_earnings.commission_earned` is stubbed $0) | Fix upstream write so commission_earned reflects reality |
| Payroll period roll-up | `get_payroll_report_GET` (spec'd 5/15, not built) | Build per the 5/15 spec |
| Owner approves | Manual via dashboard button | Keep human approval (judgment + audit) |
| ACH to techs | Manual (Teddy sends Venmo/ACH) | Stripe Connect or similar — auto-disburse on approval |

---

## 2 · The 4 horizontal layers

### ① Financial (writes at every phase)

`job_financial` becomes the per-job ledger. Every phase writes its cost/revenue piece automatically.

- Phase 2: parts_cost, parts_sell_price, parts_markup_pct, tax_on_parts
- Phase 3: labor_price, tech_commission_amount, tax_collected
- Phase 4: paid_date, eft_reference, net_profit
- Phase 5: commission_paid_date

**Tax nuance (locked in 5/15 design):** TN 9.25% on parts hardcoded. LA varies per parish — manual per job until lookup table built.

### ② Communication (customer SMS at every event)

A horizontal "Comm agent" listens to phase events and fires the right customer SMS automatically. Today this is fragmented across many agents (`appointment_scheduled`, `appointment_reminder_due`, `customer_arrival_sms`, etc.). Target: consolidate the touch points + add the missing ones.

Touch points needed (see §5 build list).

### ③ Voice (VAPI handles inbound)

All inbound calls land on a Vapi voice agent. 99% of customer asks are handled (status, reschedule, ETA, cancel). 1% falls through to voicemail → office callback queue.

**Vanity numbers** 888-ANT-8998 + 866-ANT-0111 are owned but **NOT YET WIRED** to the Vapi inbound agent. That's a hard prereq.

### ④ Audit (event_log)

Already pervasive. Every state change writes to event_log. Used for: debugging, dedup, BI agents reading history, future autopilot training.

---

## 3 · ELIMINATE list

Things that **stop existing** in the target state. Not "automate" — gone.

| Sub-step eliminated | What was wrong with it |
|---|---|
| Office manually copying emails into Ant | Poller does this; no human entry needed |
| Office calling/texting each customer to gather availability | Intake chat captures this directly from customer |
| Office choosing which tech to assign | Cluster routing + auto-broadcast decides |
| Office answering routine "where's my tech / when are you coming" calls | VAPI handles |
| Office answering "I need to reschedule" calls | VAPI handles via reschedule flow |
| Danielle pasting invoice fields one at a time on every job | Office Today renders them all paste-ready (interim); portal automation eliminates the paste step entirely (target) |
| Manual "the parts are coming Tuesday" customer text | Comm agent fires from parts ETA event |
| Manual "the tech will be late" customer text | Tech ETA chain (already exists) |
| Office manually tracking which warranty submissions were submitted | Warranty submission ledger (just shipped this morning) |
| Office checking Gmail to remember if a customer has already been contacted | Customer portal + event_log tracks everything |
| Office having to remember which jobs need follow-up | Office Today surfaces these at the right time |

**Net for Danielle:** ~70% of her current task list disappears entirely when the system is fully built.

---

## 4 · COMBINE list

Things that fold into other steps so the human only does ONE action that accomplishes many.

| Combined action | What it does in one tap |
|---|---|
| **FINISH tap (tech)** | Writes TDR + writes job_financial + flips scheduling_status + emits JOB_COMPLETED signal + triggers warranty-submission package assembly + (for self-pay) generates Stripe invoice + fires customer "repair done" SMS + adds to tech's pending earnings — all from one button |
| **Mark Submitted (office, warranty)** | Records portal submission with confirmation # + writes event_log audit + removes from Office Today due-list + sets "awaiting payment" state on job_financial — one tap |
| **Schedule from intake (system)** | Intake completion writes availability + assigns cluster + broadcasts to techs + on claim sets scheduled_start + fires customer confirmation SMS + writes job_financial row — all automatic, no human |
| **Parts ordered (Teddy/agent)** | Order via vendor API + capture cost + calculate sell price + record tax + write job_financial + fire "parts ordered, ETA …" customer SMS + monitor ETA — one trigger |
| **Approve payroll (Teddy)** | One tap reviews per-tech totals + locks values + writes tech_payroll_lines + queues ACH disburse — replaces Danielle's spreadsheet reconciliation |

---

## 5 · AUTOMATE list (with priority)

Things that need to become silent automation. **Priority order = build sequence.**

| # | Automation | Effort | Frees up |
|---|---|---|---|
| 1 | **Auto-fire customer intake-chat link SMS** when job lands at not_ready | 0.5d | Eliminates Danielle's manual morning customer outreach |
| 2 | **Wire `customer-invoice.js` to JOB_COMPLETED chain** for self-pay | 1h | Eliminates manual invoice send |
| 3 | **Consolidate Comm agent** for parts ordered/shipped/delivered/delayed SMSes | 1d | Closes the missing customer-comm gap in Phase 2 |
| 4 | **VAPI vanity number wiring** (888-ANT-8998, 866-ANT-0111 → Ant Inbound agent) | 0.5d (Teddy via Vapi dashboard + Telnyx routing) | All inbound calls auto-handled |
| 5 | **Vapi voicemail → office callback queue** surface in Office Today | 0.5d | 1% calls have a defined handoff |
| 6 | **Reschedule needed → auto customer SMS w/ A/B/C slot options** | 1d | No phone call needed |
| 7 | **`tech_earnings.commission_earned` write-back fix** | 0.5d | Unlocks `LEDGER_TASK_ENABLED` per financial flag #2 |
| 8 | **Warranty remittance email parser** (per 5/15 design: ahs_payment_intake, squaretrade_payment_intake) | 2d | Auto-match payments to jobs, kills the reconciliation lag |
| 9 | **ServicePower portal adapter** (claim submission) | 3-5d | First vendor — kills Danielle's manual paste step for ~half her warranty volume |
| 10 | **AHS portal adapter** | 3-5d | Second vendor — covers the other half |
| 11 | **Auto-schedule revisit when parts ETA passes** | 0.5d | Today: parts_arrival_check notifies; target: auto-bid slot |
| 12 | **Pre-diagnosis AI agent** (symptom + brand + model → likely parts) | 2-3d | Removes Teddy's manual Teddy Tool entry |
| 13 | **Marcone / Triple S API integration** for parts ordering | 1-2d (after vendor delivery) | End-to-end parts order automation |
| 14 | **Stripe Connect for auto ACH payouts** | 2d | Removes Teddy's manual Venmo sends |
| 15 | **Customer portal as canonical status page** + link sent in every SMS | 1d | Customers self-serve "where am I at" |

**Highest leverage in the first 3 days:** #1 + #2 + #3 + #5 + #6 + #7. Those eliminate 80% of Danielle's current tasks.

---

## 6 · HUMAN-ONLY list

Things that stay manual because they require judgment the system shouldn't make for us.

| Stays human | Why |
|---|---|
| Voicemail callback queue clear | 1% of calls — real human stuff |
| Customer complaints / refunds | Judgment + relationship |
| Vendor portal submission while adapters are being built | Until automated |
| Exception scheduling (customer asks for something outside system constraints) | Judgment |
| Payroll approval | Owner review + audit |
| Pre-diagnosis confirm (early days) | Until AI agent confidence is calibrated |
| Tech onboarding decisions / firing | Judgment |
| Vendor relationship escalations (calls to Frontdoor / SP about disputes) | Relationship |
| Marketing decisions (which campaigns to run) | Strategy |

Everything else → automate.

---

## 7 · Build priority — what we ship first

Ordered by **leverage / effort** ratio. Each row = ~ a day or less to ship; each row independently frees up real time.

1. **Auto customer intake-chat SMS on job creation** (Day 1)
2. **Wire `customer-invoice.js` to JOB_COMPLETED for self-pay** (Day 1)
3. **VAPI vanity number wiring** (Day 1, mostly Teddy in Vapi/Telnyx dashboards)
4. **Voicemail queue surface in Office Today** (Day 1)
5. **Parts shipping SMS chain** — order/shipped/delivered/delayed events (Day 2)
6. **Reschedule auto-flow** — A/B/C SMS options instead of office call (Day 2)
7. **`tech_earnings.commission_earned` fix** + activate LEDGER_TASK (Day 2)
8. **Warranty remittance parser** (per 5/15 design) (Day 3-4)
9. **ServicePower portal adapter** (Day 5-9 — parallel workstream)
10. **AHS portal adapter** (Day 10-14)

By end of week 1: 80% of Danielle's role can be backfilled by the system.
By end of week 2 (after portal adapters): ~95%.

---

## 8 · Connection to existing code (what we already have)

Surprisingly much. Building this is mostly wiring, not greenfield.

| Component | State |
|---|---|
| Gmail pollers (AHS, ServicePower) | ✅ Live, 15-min cron |
| Intake chat | ✅ Live (`tech-ant-chat.html` reused as customer surface via warranty resume flow) |
| Practice auto-scheduler | ✅ Live (cluster routing fixed today) |
| FINISH overlay + 4 outcomes | ✅ Live |
| `customer-invoice.js` Netlify fn | 🟡 Exists, not wired |
| Stripe webhook | ✅ Live (cash TDR + SaaS) |
| `record_warranty_submission` | ✅ Shipped this morning |
| Office Today single-pane | ✅ Phase 1 shipped this morning |
| `appointment_scheduled`, `appointment_reminder_due`, `customer_arrival_sms`, `followup_due`, `google_review_request` agents | ✅ All live |
| `parts_arrival_check` agent | ✅ Live, daily 11am |
| Vapi voice agents (11 total) | 🟡 3 live, 8 unverified |
| Vapi vanity number routing | 🔴 Numbers owned, not wired |
| `customer-portal.html` status page | ✅ Live |
| Comm agent (consolidated) | 🔴 Doesn't exist — touch points scattered across many agents |
| Warranty remittance parser | 🔴 Spec'd 5/15, not built |
| ServicePower / AHS portal adapters | 🔴 Scoping doc only (`docs/warranty-portal-automation-scoping-2026-05-31.md`) |
| Pre-diagnosis AI agent | 🔴 Concept only |
| `tech_earnings.commission_earned` upstream write | 🔴 Always $0 (per financial flag #2) |
| Marcone / Triple S parts API | 🔴 Pending vendor delivery |
| Stripe Connect for ACH payouts | 🔴 Not built |

**Net assessment:** ~60% of what we need already exists in some form. The work is mostly **wiring + activation**, not new construction.

---

## 9 · What's NOT in this doc

- Marketing / lead-gen automation (separate track)
- SaaS multi-tenant work (post-cut)
- Vector store / semantic search (post-cut)
- 379-agent colony build (continues background)

These don't affect the daily office operation.

---

## 10 · Next decisions

After Teddy reviews this doc:

1. **Confirm build priority order** in §7 — anything to re-rank
2. **Pick today's #1** — what ships first this afternoon
3. **Decide Vapi wiring timing** — Teddy needs ~30 min in the Vapi + Telnyx dashboards
4. **Confirm the autopilot end-state** — the office that runs in 2-3 hours/day is the target; this doc is the map to get there

Once those land, we build the priority list top-down, one shipped piece a day.
