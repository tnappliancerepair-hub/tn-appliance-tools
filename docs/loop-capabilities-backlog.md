# Capabilities Backlog — harvested from the ~429 archived agents

*2026-08-02. Companion to `loop-redesign-postgres-migration.md`. Before we archive
the dead agents, we extract the **ideas** here so deleting the **code** provably
loses nothing.*

## What we're keeping vs deleting
The ~429 unused agents are **auto-generated templates** (COLONY_ARCHITECT era):
each takes a signal → calls Claude with a specialty prompt → emits an "INSIGHT"
signal **that nothing consumes**. The *code* is negative-value (Claude calls that
dump output into a dead-letter; several are mis-generated, e.g. an "AR aging"
agent filed under *market intelligence* whose own prompt says it doesn't do AR
aging). **We archive all of it.**

But the *specialty names* are effectively an unbuilt feature backlog. This doc
harvests the worthwhile ones, ranked.

**The rule for building any of these:** don't resurrect the stub. Build the
feature fresh, wired to **a consumer that actually acts** (a queue, a text, a
board card) — because the missing piece was never "wire the agent," it was
"what do we *do* with the output." And check the "already live?" column first so
we *extend* what exists instead of rebuilding it.

---

## 🔥 TIER 1 — build-worthy (real money / real need)

### 1. Recruiting & hiring funnel  *(harvested from 32 `recruiting_*`)*
You actively need techs; this is the strongest case in the whole pile.
- **Best pieces:** Application Qualifier, Resume Quality Scorer, Phone Screen Generator, Candidate Nurture, Candidate Ghost-Followup, Hiring Velocity, Referral Program Manager, Trade School Outreach, Indeed/Facebook/TikTok/LinkedIn posting generators, Onboarding Document Builder, Compensation Benchmarker, Tech Recruiting Demand Forecaster.
- **The consumer that acts:** a lightweight recruiting board — "candidate X stalled Y days → next action Z," auto-drafted outreach you approve, auto-posted job ads to the channels you already post to.
- **Already live?** No. Net-new, but reuses your social-posting rails.
- **Priority:** High. Start with the funnel tracker + ghost-followup + one channel's auto-posting.

### 2. Service agreements & recurring revenue  *(from 10 `service_agreement_*`)*
Recurring revenue you're not capturing today.
- **Best pieces:** Service Agreement Proposal, Agreement Renewal, Maintenance Reminder, Equipment-Age Alert / Age-Risk Profiler, Post-Job Education, Multi-Appliance Household Tagger, Upsell Intelligence.
- **The consumer that acts:** after a completed job, auto-offer a maintenance plan; renewal reminders; equipment-age → proactive "time for a checkup" outreach.
- **Already live?** *Partially* — `MAINTENANCE_REMINDER_DUE` and `UPSELL_DUE` exist. So this is **extend, not build-from-zero**: add the proposal + renewal + household-tagger layer on top.
- **Priority:** High. Recurring revenue is the highest-leverage money idea here.

### 3. Customer intelligence → retention / win-back  *(from 16 `customer_intel*`)*
Drives repeat jobs and tells you where to grow.
- **Retention pieces:** Churn-Risk Scorer, Retention Cohort Analyzer, Segment Classifier, Sentiment Tracker, Proactive Outreach, Review-Solicitation Optimizer, Appliance-Age Profile, Birthday Watcher.
- **Growth/geo pieces:** Geographic Cluster Density, Service-Area Demand Heatmap, New-Subdivision Detector, Service-Zone Expansion Recommender, Property-Owner-Type Classifier.
- **The consumer that acts:** a **win-back queue** (churn-risk customers → an outreach text you approve) + a **"where to expand/market" map** for you.
- **Already live?** Customer Lifetime Value is the *one* live agent in this family; the rest are new. Review solicitation overlaps `GOOGLE_REVIEW_REQUEST` (live).
- **Priority:** High for win-back; Medium for the geo/expansion map.

---

## 🟡 TIER 2 — worth building, not urgent

### 4. Tech performance coaching + mentorship  *(from 14 `performance_*` + 9 `mentorship_*`)*
Ties directly to the #1 goal — better techs.
- **Coaching pieces (the valuable half):** Diagnostic-Accuracy Coach, TDR-Completeness Coach, Callback-Rate Coach, Time-Per-Job Coach, Customer-Communication Coach, Upsell-Opportunity Coach, First-90-Days, TDR Tutor, Daily Reflection.
- **The consumer that acts:** per-tech coaching surfaced on the tech dashboard + to you, grounded in each tech's real TDR / callback / time metrics (data you already have in tech-performance).
- **Mentorship system pieces** (Mentor Matching, Mentee Progress, Mentor Equity Calculator, Advancement/Demotion, Tree Health): a whole mentorship-comp structure — **probably more than you need now**; keep the *coaching* layer, park the equity/tree machinery.
- **Already live?** No (tech-performance *reporting* exists; coaching does not).
- **Priority:** Medium. High-fit with the mission, but after recruiting/recurring-revenue.

### 5. Content / social engine  *(from 11 `content_generator_*`)*
You do this by hand today — and you already built the pipeline to publish it.
- **Best pieces:** Customer Save Stories, Tech Hero, Testimonial Curator, Case Study, Tech-Tip Snippet, Community Impact, Founder Voice, "Why We Built Ant," Year-in-Review.
- **The consumer that acts:** feed auto-drafted post ideas (mined from real closed jobs) into your **existing** `video-studio` / `social-drafts` / `content-ideas` / post-everywhere pipeline.
- **Already live?** *Yes, substantially* — `content-ideas`, review-cards, and the post-everywhere engine exist. So this is **feed the existing engine**, not build a new one. Lowest effort in Tier 2.
- **Priority:** Medium (cheap because the rails exist).

---

## ⏸️ TIER 3 — later / conditional

### 6. HVAC expansion  *(from 15 `hvac_*`)*
A coherent, real set for an adjacent trade: AC Charge Calculator, Refrigerant-Recovery Compliance, Duct-Loss Estimator, Commissioning Checklist, Permit & Licensing, Tax-Credit Surfacer, Brand-Bulletin Watcher, HVAC TDR Tutor, IAQ Specialist, Manufacturer Technical Data.
- **Gated on a business decision:** only worth building if/when you expand into HVAC. Until then, archive the idea intact — it's a ready blueprint for that day.
- **Priority:** Later (decision-gated, not effort-gated).

---

## ❌ SKIP — dead code, little value even as ideas
- **`scout_request_*` (52)** — vague "research/scouting" agents, no clear consumer or business outcome. Delete; nothing to harvest.
- **`market_*` (14)** — auto-generated combinatorial junk (the AR-aging-as-market-intel case proves it). A real competitor-watch, if ever wanted, is a tiny purpose-built thing — not this. Delete.
- **`sms_response_*` (50)** — already superseded by the live direct inbound handlers (`inbound_customer_sms.js` / `customer_sms_reply.js`). Pure duplicate. Delete.
- **`parts_lookup_*` per-supplier×appliance (~50)** — superseded by the single live `PARTS_LOOKUP_REQUEST` + the mSupply/Marcone API. Delete.
- **Terminal "insight" emitters** — RECRUITING_INSIGHT, MARKET_INTELLIGENCE, etc. that go to nobody. Delete (they're just queue churn).

---

## How to use this
- Archiving the ~429 agents now loses **zero ideas** — they're all captured above.
- When we want a Tier-1/2 capability, we build it **for real** on the new (post-migration) stack: a real consumer that acts, wired + tested, extending live features where the "already live?" column says so.
- Revisit this list after the migration — recurring-revenue (service agreements) and recruiting are the two that most directly move the business.

## Priority shortlist (if we build in order)
1. **Service agreements / recurring revenue** — highest money-per-effort, extends live upsell/maintenance.
2. **Recruiting funnel** — solves a real, current bottleneck (you need techs).
3. **Customer win-back queue** — repeat jobs from churn-risk customers.
4. **Content engine feed** — cheap; the publishing rails already exist.
5. **Tech coaching** — mission-fit; after the revenue/hiring wins.
6. **HVAC** — when/if you expand.
