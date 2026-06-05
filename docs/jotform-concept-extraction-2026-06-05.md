# Jotform concept extraction — design spec for absorption

Captured 2026-06-05 from Teddy's screenshots of his existing Jotforms. This is the design spec for the next 2-3 weeks of TDR + consumer-facing work. The goal: extract every smart concept from the Jotforms and absorb it into Ant, then cancel the Jotform subscription.

## The four Jotforms

| # | Name | Status | Absorb plan |
|---|---|---|---|
| 1 | Release of Liability / In-Home Service Authorization | ✅ Shipped 6/5 (`/waiver.html`) | Cancel anytime |
| 2 | Warranty Quick Check™ (consumer self-screen) | ⏳ Partial via Brooke + portal | Build `/quick-check` consumer page |
| 3 | Technician Decision Report (V2 — rich diagnostic) | ⏳ Partial via Brooke + TDR card | Schema + Brooke prompt + UI expansion |
| 4 | Original TDR (V1 — just name/address/phone) | ✅ Already in 4 intake channels | Cancel anytime |

## What Jotform #2 (Warranty Quick Check™) is teaching us

The consumer-facing self-screening tool. Customer answers a short form, uploads photos + a 15-20 sec video, and the system gives them an answer on whether to fix or replace. Fields:

- Customer name + phone + email
- Appliance type / brand / model number
- Free-text issue description (with prompts: noises, leaks, error codes, temperature)
- Photo of appliance
- Model tag photo
- 15-20 second video of the issue
- State / ZIP / Street / City
- Scheduling notes
- Warranty company + claim number

**What Ant already does for this flow:**
- Customer-portal renders status + photos (read-only side)
- Brooke captures intake via voice on inbound calls
- Vision OCR Phase 1 already auto-fills model number from the model tag photo
- Vision OCR Phase 4 already runs walkaround assessment on the video

**What's missing for the FULL Quick Check vision:**

1. A consumer-facing page at `/quick-check` that takes form input + media uploads
2. Server-side routing of input through a `quick_check_analyzer` agent (Claude on the photo + video + symptom text + parts catalog corpus)
3. Output a structured answer: estimated cost range + DIY feasibility + final recommendation + tech availability
4. Customer either accepts the answer or schedules a tech visit

**Build complexity:** ~6-8 hours for V1 (no live parts pricing — use historical TDR data as the corpus). Each cycle improves accuracy.

## What Jotform #3 (TDR V2) is teaching us — the richer data model

Current Ant TDR has these fields:
- `diagnosis` (text)
- `failed_component` (text)
- `labor_time_hours` (decimal)
- `repair_completed` (text)
- `parts_needed` (text)
- `customer_notes` (text)

Teddy's Jotform V2 has these ADDITIONAL fields:

### Confidence pair (currently smushed into one)

- **`diagnosis_confidence`** — enum: high / medium / low
  - High: "the issue identified is the root cause"
  - Medium: "additional testing may be needed"
  - Low: "issue cannot be confirmed without further inspection"
- **`part_confidence`** — enum: high / moderate / low (SEPARATE from diagnosis)
  - High: "this is the correct part"
  - Moderate: "additional testing recommended"
  - Low: "part cannot be confirmed without further inspection"

Real-world example: tech is 95% sure the issue is the ice maker module BUT only 70% sure on which exact part number across Whirlpool's 4 revisions. Today Ant smushes those into one field. Should be two.

### Cost + DIY decision triad

- **`estimated_cost_low`** + **`estimated_cost_high`** — cents range
- **`diy_feasibility`** — enum:
  - `easy` — capable homeowner could complete with basic tools
  - `moderate` — several hours, intermediate skill
  - `difficult` — technical complexity, not recommended for beginners
  - `do_not_recommend` — safety risk or advanced disassembly
- **`final_recommendation`** — enum:
  - `diy_reasonable`
  - `schedule_install_after_parts`
  - `upgrade_premium_video_diagnostic` — **NEW SERVICE LINE**
  - `schedule_in_home_visit`
  - `replacement_more_economical`

### Customer-facing notes (separate from internal)

- **`technician_customer_notes`** — what the tech wants the CUSTOMER to know
  - Distinct from `customer_notes` which is currently used internally
  - Sanitized before display, no internal jargon

### Verified part number (with disclaimer)

- **`verified_part_number`** — the EXACT part number the tech confirms is needed
  - Different from `parts_needed` which is a list
  - Pairs with `part_confidence`
- The disclaimer: "TN Appliance Exchange installs only parts supplied by our company. Customer-purchased parts are not installed. This ensures the correct part is used and allows us to stand behind the repair."
  - Now included in warranty submission package (shipped 6/5)
  - Should also surface on customer-portal TDR view

## Brooke prompt additions for wrap-up mode

When tech says "I'm done" or hits Mark Complete, Brooke's wrap-up checklist should expand to ask:

1. **Diagnosis confidence**: "On the diagnosis — high confidence, medium, or low?"
2. **Part confidence**: "Same on the part you're putting in — high, moderate, or low?"
3. **Cost range** (when Quick Check publishing): "Ballpark cost range for this repair if a customer were to call us — low end and high end?"
4. **DIY feasibility**: "If a determined homeowner wanted to try this themselves — easy, moderate, difficult, or do-not-recommend?"
5. **Final recommendation**: "Bottom line for the customer — DIY OK, in-home visit, install after parts, video diagnostic upgrade, or replacement makes more sense?"
6. **Customer notes** (already in flow): "Anything you want the customer to know specifically?"

These 6 prompts add ~30 sec to wrap-up. Each one feeds the Quick Check corpus.

## Phased absorption plan

### Phase A (next session, ~2 hours)

Schema + endpoint + Brooke prompt expansion:

- Add 8 columns to `technician_decision_report` table
- Extend `update_tdr_field_from_voice_POST.xs` to accept the new enums + cost fields
- Extend `save_tdr_final_from_voice_POST.xs` to validate the required new fields
- Update Brooke's wrap-up prompt with the 6 new questions
- Update `ant-tdr-card.js` to render the new fields per role:
  - Tech sees: all of them, can edit
  - Office sees: all of them
  - Customer sees: customer-facing notes + recommendation summary

### Phase B (~3 hours)

Customer-facing Quick Check page:

- Build `/quick-check.html` (mobile-first, no auth — public marketing surface)
- Form mirrors Jotform #2 fields
- Photo + video upload routes through existing s3 + Vision OCR pipelines
- New `quick_check_analyzer.js` agent processes input via Claude:
  - Input: appliance + symptoms + photos + video frames + parts catalog corpus
  - Output: estimated cost range, DIY feasibility, final recommendation, top 3 likely failed components, top 3 likely parts
- Display structured answer to customer
- "Schedule a tech" CTA flows to existing book endpoint (gated by waiver)
- All quick-check submissions feed the corpus for future improvement

### Phase C (~2 hours)

Premium Video Diagnostic service line:

- New service type in the system: `premium_video_diagnostic`
- Customer who gets a "difficult" DIY rating + chooses to attempt sees an upsell:
  - "Want a tech to walk you through it via video? $89 flat fee."
- Customer pays via Stripe, schedules a 30-min Vapi video session
- Vapi assistant joins the call as a "live tech" with vision capabilities
- New revenue stream + new differentiation

## Strategic implications

1. **Consumer Quick Check is a marketing channel** — every customer who answers honestly "yes I want my appliance fixed" turns into a lead. This shifts Ant from "captures jobs the office gets" to "generates jobs the office wouldn't otherwise get."

2. **Premium Video Diagnostic is a new revenue category** — $89 per session, ~10-min real tech time. High margin. Differentiates from competitors who don't have remote-tech capability.

3. **The DIY rating + final recommendation form a data flywheel** — every job produces a row of (symptoms, diagnosis, parts, cost, outcome). After 200-500 jobs, the system can predict these without a human tech for common cases.

4. **The "we only install our parts" disclaimer is legal hygiene** — limits liability if a customer buys a wrong part from Amazon and demands the tech install it. Worth surfacing on customer-portal too.

5. **Cancel Jotform on Day 30** — once Phase A + B ship, Jotforms #2, #3 are absorbed. Cancel subscription. Estimated savings: $29-99/month depending on tier.

## The longer arc

The Jotforms were design specs Teddy didn't know he was writing. Each one solved a specific operational problem. The act of digitizing those specs into Ant is also the act of teaching Ant what Teddy already knows about the business. **Once all 4 Jotforms are absorbed, Ant has internalized the operational instincts that took 4+ years of running a repair shop to develop.** That's the foundation of the SaaS offering — every shop that buys Ant gets Teddy's instincts for free.

---

## Field additions checklist (for Phase A next session)

```sql
ALTER TABLE technician_decision_report ADD COLUMN diagnosis_confidence text;
ALTER TABLE technician_decision_report ADD COLUMN part_confidence text;
ALTER TABLE technician_decision_report ADD COLUMN verified_part_number text;
ALTER TABLE technician_decision_report ADD COLUMN estimated_cost_low_cents int;
ALTER TABLE technician_decision_report ADD COLUMN estimated_cost_high_cents int;
ALTER TABLE technician_decision_report ADD COLUMN diy_feasibility text;
ALTER TABLE technician_decision_report ADD COLUMN final_recommendation text;
ALTER TABLE technician_decision_report ADD COLUMN technician_customer_notes text;
```

(For Xano: use metadata API column-add endpoint per the documented footgun rules. Enum values stored as text since Xano's enum mutation path is hostile.)

## Next-session todo

- [ ] Add 8 schema columns
- [ ] Extend update_tdr_field_from_voice to accept new fields
- [ ] Extend save_tdr_final_from_voice to require diagnosis_confidence + part_confidence on warranty jobs
- [ ] Update Brooke's wrap-up prompt with the 6 new questions
- [ ] Update ant-tdr-card.js modal to render new fields (role-aware)
- [ ] Update buildSubmissionPackage to include new fields in vendor portal text
- [ ] Build /quick-check.html consumer page
- [ ] Build quick_check_analyzer.js agent
- [ ] Build Premium Video Diagnostic service flow
- [ ] Verify on Jimmy's next job that Brooke captures all the new fields naturally
- [ ] Cancel Jotform subscription

This document IS the design spec. Hand to Claude next session and say "execute Phase A" — that's enough to ship.
