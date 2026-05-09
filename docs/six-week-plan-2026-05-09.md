> 6-week execution plan authored 2026-05-09 evening Central. Companion to docs/system-blueprint-v1.md, docs/system-blueprint-decisions-2026-05-09.md, and the recovered handoffs. Purpose: get from "well-documented vision" to "real techs and real customers using the system in production with measurable proof."

---

# TN Appliance Exchange — Six-Week Execution Plan

## Strategic frame

Per docs/system-blueprint-v1.md Section 14 (Strategic goal): prove the system works in production with real techs and real customers, then let the best ideas win. Optimize for time-to-working-proof, iteration speed, scalability path. Architecture decisions are evidence-driven, not theory-driven.

This plan runs three rhythms in parallel:
1. Build what's needed for proof (forward motion)
2. Capture friction in production (real techs, real customers, real edge cases)
3. Iterate based on captured friction (what broke gets fixed, what surprised gets learned, what worked gets hardened)

---

## Week 1 — Get existing dormant systems running in production

Goal: end the week with SMS firing, Tech Assist active, Tech Scheduler broadcasting, at least one real customer journey completed end-to-end. Not feature-perfect, just running.

Monday-Tuesday:
- Build SMS_ENABLED master kill-switch (per Decision 6, ~30-60 min)
- Build the four customer transparency SMS triggers (Teddy started review, parts ordered, parts shipped, parts delivered DIY/Install branches), all gated by SMS_ENABLED
- Vapi general-purpose status agent (or repurpose existing pending Vapi inventory)

Wednesday:
- 10-min Vapi dashboard inventory (manual, by Teddy)
- TCR clearance check — if clear, flip SMS_ENABLED=true, walk one real customer journey live
- Phase 8b polish from May 4 handoff: day-of-week math fix and no-op prose fix

Thursday:
- Flip TECH_ASSIST_ENABLED=true on a real job
- Walk one tech through Tech Assist on actual repair, with Teddy watching
- Capture every friction point

Friday:
- Flip SCHEDULING_QUEUE_ENABLED=true on a small slice (one cluster, Teddy's own jobs as test)
- Watch broadcasts fire on real jobs
- End-of-week observation pass

Output: docs/friction-week-1.md committed.

---

## Week 2 — Stabilize what's running, build Phase 6b

Goal: whatever broke in Week 1 gets fixed. Customer reply handler for sick-day cascades (Phase 6b) ships.

Monday-Tuesday:
- Triage Week 1 friction journal. What's a blocker vs nice-to-fix? Fix blockers.
- Patch critical bugs in customer transparency SMS, Tech Assist, or Tech Scheduler.

Wednesday-Thursday:
- Build Phase 6b — customer reply handler for sick-day cascades. When sick tech triggers reschedule SMS, customer replies currently go to humans. Make it fully automated.

Friday:
- Unified-tool architecture conversation (deferred from today's hypothesis doc) — now with a week of real data behind it. Either confirm Option B, modify it, or walk a different direction. Document the decision.

Output: docs/friction-week-2.md, architecture decision committed.

---

## Week 3 — Begin warranty portal automation (biggest manual sink)

Goal: start automating Danielle's biggest manual workflow. AHS API integration begins.

Monday-Tuesday:
- AHS API research — read API docs end-to-end, scope TDR submission endpoint, identify auth flow, document any access blockers
- Decision: build straight against AHS API, or build a generic "warranty portal submission" abstraction that routes to AHS now and ServicePower later

Wednesday-Friday:
- Build AHS API integration. Endpoint takes a closed warranty job + completed TDR data, submits to AHS, captures response, alerts Danielle on failure.
- Test on real jobs in parallel with Danielle's existing manual flow — don't replace yet, compare results

Output: docs/friction-week-3.md, AHS API integration in shadow mode.

---

## Week 4 — AHS API live + ServicePower SOAP begins

Goal: AHS API stops being shadow-mode, becomes default. ServicePower SOAP begins.

Monday-Tuesday:
- AHS API verified on 3-5 real jobs in parallel mode
- Cut over: AHS jobs auto-submit. Danielle reviews instead of submits.
- Capture failure modes for first week of real auto-submission

Wednesday-Friday:
- ServicePower SOAP integration begins. Five integration guides already saved in docs/servicepower/.

Output: docs/friction-week-4.md, AHS API live.

---

## Week 5 — Capacity governor + scheduling intelligence

Goal: Phase 3 capacity governor unblocks. Scheduling intelligence improves.

Pre-week prep:
- Schedule a 30-min working session with Danielle to answer the per-tech vs per-area question. If she's been unresponsive, Teddy inspects ServicePower portal directly and makes the call.

Monday-Wednesday:
- Build Phase 3 capacity governor based on locked architecture
- Wire it into scheduling decisions

Thursday-Friday:
- ServicePower SOAP integration continues / completes
- Allstate parser — scope and start (the thing TCR pivot displaced)

Output: docs/friction-week-5.md, capacity governor live.

---

## Week 6 — Polish, observe, decide what's next

Goal: what survived contact with reality gets hardened. What didn't gets rethought. The system feels production-ready or it doesn't, and Teddy knows exactly why either way.

Monday-Tuesday:
- ServicePower SOAP live on real jobs
- Polish: every UX rough edge that surfaced in Weeks 1-5

Wednesday-Thursday:
- 6-week retrospective. Re-read all friction journals. Look at what's actually different about the business.
- Quantify: how many customer-facing manual steps eliminated? How many of Danielle's hours saved? How many tech complaints reduced? How many TDR fields auto-captured vs missing?
- Decide: is this proof? If yes, start scaling conversations. If no, what's the gap?

Friday:
- Plan Week 7+ based on Week 6 reveals.

Output: docs/friction-week-6.md, retrospective doc, scaling decision.

---

## Companion artifacts (created and updated weekly)

- docs/friction-week-N.md — every Friday afternoon, 30 min minimum. What broke, what surprised, what customers said, what techs said, what Danielle said, three things to change if starting over.
- docs/external-blockers.md — TCR clearance, Marcone B2B API, Danielle response on Phase 3, HCP support ticket, RingCentral port. Updated weekly. When blocker clears, dependent work jumps priority. When blocker drags >2 weeks, decide: escalate, work around, or defer.
- docs/displaced-this-week.md — what got pushed each week. By Week 4 patterns emerge — same thing keeps getting pushed means either it's not as important as thought, or structurally blocked.

---

## Success at Week 6 — concrete, measurable

- At least 10 real customer journeys completed with all four new transparency triggers firing
- At least 5 warranty TDR submissions auto-submitted via AHS API (Danielle reviewing, not submitting)
- Tech Assist active on every job with required-field enforcement
- Tech Scheduler broadcasting on at least one cluster with techs claiming via SMS
- Friction journal documenting every breakage, surprise, learning
- Clear picture of: what's working, what's broken, what's needed next, whether ready to scale

If yes to all: scaling conversations begin (more techs, licensee #1, etc.).
If no: know exactly why and what's next.

---

## What this plan does NOT include

Anything about licensing, new customer acquisition, or hiring. Those come AFTER proof. Don't let them creep into the next 6 weeks unless one becomes urgent.

## What this plan accepts will happen

Slip. TCR clearance might take longer. Marcone might never approve. Danielle might not engage. A tech might quit. A customer issue might consume a week. Slip is information, not failure. Friction-capture and displaced-work-tracking are built in for exactly this reason.

---

## Status

Authored 2026-05-09 evening. Activates Monday 2026-05-11 (or whenever Teddy starts Week 1).
