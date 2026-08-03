# Agent Ideas — Good vs Waste (triage of the 238 archived agents)

*Rewritten 2026-08-03 after the actual archive ran (556→318 live; 238 moved to
`colony-loop/agents/archive/`). This supersedes the earlier tier list — sharper,
grounded in the levers the business is ACTUALLY pushing on, not the architect's
auto-generated ambition. The archived code stays reversible; this doc decides what
gets a real, wired rebuild vs. what eventually gets deleted.*

**The test.** A "good idea" moves a lever we're actually pushing on:
1. the **#1 goal** — the most advanced troubleshooting brain,
2. **warranty labor** — 95% of jobs, Danielle's biggest manual load,
3. **recurring revenue** — maintenance plans / proactive service (the growth + platform direction),
4. the **money scoreboard** — the E-Myth weekly instrument,
5. **retention** — keep + win back the customers we already earned.

"Waste" = **premature** (built for a scale we're not at), **superseded** (a real tool already does it), or **auto-generated filler** (per-source×appliance sprawl).

---

## 🟢 BUILD-WORTHY — real lever, worth a focused rebuild

### 1. Warranty claim automation ⭐ *(11: `warranty_claim_*`, `warranty_warranty_*`, `warranty_frontdoor_*`)*
Claim-status pollers, denial-pattern analysis, resubmission, payment reconciliation, authorization requests, claim-language optimizer. **The single biggest labor-saver** — warranty is 95% of the work and claim paperwork is Danielle's heaviest manual load. Dead only because the **ServicePower / Frontdoor APIs aren't fully wired yet** (documented in-progress). The moment those land, this is #1 to revive. The *concept* is gold; the code needs the API + a rebuild on the new spine.

### 2. Money / BI feeds for the scoreboard *(8: `market_business_*` + `payroll_calculator`)*
AR aging, cash position, profitability-by-zone, tax-liability forecast, tech-earnings reconciler, warranty-reimbursement lag, fleet cost. **These ARE the weekly scoreboard + money system** (E-Myth instrument, `docs/weekly-scoreboard.md`). Mislabeled "market_business," but they're financial vital signs. Revive as **one BI job that computes the north number + red number**, not 7 separate agents.

### 3. Recurring revenue *(10: `service_agreement_*` + `proactive_failure_warning`)*
Maintenance-plan proposals, agreement renewals, equipment-age alerts, post-job education, proactive failure warnings. **Recurring revenue is the growth lever** (steady cash + the L3 consumer-platform direction). Worth a lightweight real build: proactive maintenance reminders + a simple service-agreement offer at job close.

### 4. Retention / win-back *(the useful ~5 of 14 `customer_intel*`)*
KEEP what moves retention: **churn-risk → win-back outreach**, **appliance-age → proactive service**, **service-area demand heatmap → where to focus**. DROP the fluff (birthday watcher, sentiment tracker, segment classifier — noise, no action).

### 5. Small friction-killers *(individual)*
- `tdr_autofill_from_chat` — kills the tech's #1 friction (finishing the TDR); ties to the "no stop without a completed TDR" vision.
- `translate_spanish_intake` — multilingual is already a live priority.
- `customer_reschedule_offer` — reschedule automation, real office time saved.

---

## 🟡 GOOD CONCEPT, WRONG FORM — build a focused few, dump the sprawl

### 6. Brain external-knowledge ingestion *(58: `scout_request_*` 52 + `research_request_*` 6)*
The **concept directly serves the #1 goal** — pull external repair knowledge into the brain (iFixit, Appliantology, MarconeAI, ServiceMatters, manuals, brand diag-modes). But **52 per-source × per-appliance scrapers is waste.** Build **~3–4 focused, grounded sources** (MarconeAI, an internal TDR-history miner, one manuals/tech-sheet source) that feed `ant-troubleshoot` — not 58 brittle agents. Keep the idea, delete the sprawl.

### 7. Smart-scheduling optimizers *(40: `schedule_request_*` + `schedule_*`)*
Route optimizer, gap calculator, real-time gap watcher, tech buffer, flexibility scorer, squaretrade anchor… The **good concepts are already LIVE** (SCHEDULER_FILL_GAP, TECH_PACE_WATCHER → RUNNING_AHEAD/BEHIND — the self-scheduling autopilot). These 40 are overlapping auto-variants of things we already do better. Mostly **delete**; cherry-pick 1–2 genuinely new angles only if a gap appears.

### 8. Self-improvement loops *(5: `voice_prompt_*` 4 + `first_visit_fix_rate`)*
Transcript-analyzer → prompt-improvement, first-visit-fix-rate tracking. **Concept is right** (measure → improve) and **already partly built** (phone-trust-scorecard, ant-brain-score, the new eval harness). Fold the useful bits into what exists; don't rebuild as separate agents.

---

## ⏸️ LATER / CONDITIONAL — real someday, premature now

- **Recruiting & hiring** *(20: `recruiting_*`)* — Indeed posts, referral program, resume scoring, candidate nurture. Real **when we hire at volume** (the E-Myth "design Teddy out of seats" arc), but a hiring funnel for a **5-tech shop is premature.** One lightweight "post + referral" tool later, not 20 agents.
- **Mentorship / tech progression** *(9: `mentorship_*`)* — mentor matching, equity calc, tree health. Premature at 5 techs. Revisit when the org chart has tiers to fill.
- **HVAC expansion** *(15: `hvac_*`)* — diagnostics, refrigerant compliance, permits, tax credits, install ops. This is a **market-entry decision, not an automation task.** Bigger tickets, real adjacency — build only if Teddy decides to enter HVAC. Park until then.

---

## 🔴 PURE WASTE — delete (superseded or filler)

- **`content_generator_*` (11)** + **`blog_post_generator`** — superseded by the working content tools (`content-ideas.html`, review-cards, the post-everywhere engine).
- **`deploy_xs`** — the broken auto-deploy (dead; XS deploys are manual anyway).
- **`assign_parallel_test_jobs`** — a test scaffold.
- **`loop_latency_watch`, `claude_outcome_linker`, `receipt_ocr_extract`, `license_expiry_check`, `out_of_area_check`, `customer_intake_reply`, `availability_request`, `tech_job_offer`** — superseded by live equivalents or one-off dead ends. Low/no value even as ideas.
- **The `customer_intel` fluff** — birthday/sentiment/segment (noise, no action attached).

---

## The one-line verdict
**Revive (in order):** warranty-claim automation (when the APIs land) → money/BI scoreboard feeds → recurring-revenue (maintenance + agreements) → retention win-back → the tech friction-killers. **Build focused, not sprawling:** external-knowledge = ~4 real sources, not 58 scrapers. **Delete:** content_generator, blog_post, test scaffolds, the schedule/self-improve dup variants (already live better). **Park:** recruiting, mentorship, HVAC — real someday, not now.

*Nothing here is urgent — the archive already made the live loop lean. This is the map for when we choose to turn a dead idea back on: build the ones tied to a real lever, on the new Postgres spine, wired to a real producer + verified — never the architect's fire-and-forget way.*
