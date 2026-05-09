# Unified Tech Tool — Architectural Working Hypothesis

**Status:** WORKING HYPOTHESIS ONLY — NOT FOR EXECUTION.
**Reconvene:** Week 2, evidence-driven, after real operational data lands.
**Source:** 2026-05-09 chat session reasoning against Teddy's effectiveness criteria.
**Companion documents:** `docs/system-blueprint-v1.md`, `docs/system-blueprint-decisions-2026-05-09.md`, `docs/tech-scheduler-vs-assist-discovery-2026-05-09.md`.

---

## Critical framing — read this first

This document records architectural reasoning produced **before** any of the dormant systems had been turned on in production. It is preserved as a working hypothesis to revisit AFTER real techs and real customers have used the existing systems and observable friction has been captured.

The goal Teddy articulated: prove the theory works in production with real techs and real customers, then let the best ideas win. This means architecture decisions should be **evidence-driven, not theory-driven**. Until evidence is in hand, the working answer to "should Tech Scheduler and Tech Assist merge?" is **"we don't know yet — flip the gates, observe what breaks, and decide."**

---

## Teddy's effectiveness criteria (in priority order)

1. **Schedule reliability** — techs get accurate scheduling for when, where, and how they want to work
2. **Drama elimination** — automated absorption of the friction layer (call-offs, no-shows, preferences, complaints) that human dispatchers handle today
3. **Information capture** — every claim/job gets all data needed to process effectively
4. **Scalability** — works for 6 techs today AND scales to many licensees nationally

The right architecture is whatever maximizes these four, in this order, sustainably. **None of the four can be measured against the existing systems until those systems are live in production.**

---

## Working hypothesis (preserved for week 2 reconvene): Option B (Data Plane Merge)

**One brain, multiple voices.** Tech Scheduler and Tech Assist remain as distinct presentation surfaces (SMS for mobile/scheduling, Web for in-home/capture) but unify into a single shared data plane.

**What gets unified:**
- Unified tech identity / phone-lookup layer
- One `tech_session` concept spanning schedule + in-field
- One performance ledger ingesting signals from both surfaces
- One preference store, one pattern-detection engine, one escalation pipeline
- Unified Vapi voice persona for outbound calls

**What stays separate:**
- SMS handler (mobile-native, conversational, paired-token vocabulary)
- Web handler (in-home, photo/video-rich, customer-facing-template-driven)
- Customer-facing surfaces

**Why this hypothesis (against effectiveness criteria):** Schedule reliability, drama elimination, and information capture all benefit from cross-surface signal visibility that doesn't exist today. Scalability benefits from a brain-level data model that licensees can wrap with their own UI preferences.

**Why NOT the other options:** Option A is cosmetic only. Option C over-merges and forces one UI for genuinely different contexts. Option D doesn't unlock platform play.

---

## Why this is hypothesis-only (not yet decided)

The reasoning above is theoretical. It is grounded in design docs and code-state, **not in observation of real techs using the systems**. Specifically NOT yet known:

- How often, in actual operation, does a tech with an active in-field Assist session also receive a Scheduler broadcast? If rarely, the cross-surface visibility benefit is small.
- What patterns in tech behavior do Teddy and Danielle wish the system saw today across both surfaces? Until articulated against real cases, this is speculation.
- Where does information capture actually fail today? Without production data, it is unknown whether the bottleneck is missing fields, missing motivation, missing time, or missing tooling.
- What do techs say is broken when they actually use the systems? Their voice is the missing input.

---

## Phasing (subject to week 2 validation)

**Recorded for reference only. Do not execute these phases until evidence-based validation in week 2.**

- **Phase 1:** Unified `tech_session` table superseding partial overlap with `tech_assist_session`
- **Phase 2:** Performance ledger ingests Assist signals; Scheduler routing uses them
- **Phase 3:** State router on shared Twilio number — active in-field session routes to Assist context
- **Phase 4:** Unified Vapi voice persona with shared variable context
- **Phase 5:** Cross-system pattern detection (drama elimination layer)

---

## What still needs to be locked before any execution

1. The **9 design decisions** for Ant Tech Scheduler — currently not in repo. Must be captured before any unified-tool work proceeds.
2. **Validation against real-world operational observations** from week 1 production run.
3. Decision on Vapi unified voice persona (per Decision 2 in `docs/system-blueprint-decisions-2026-05-09.md`).
4. Long-term goal alignment with the licensable platform vision and how it shapes acceptable trade-offs.

---

## Status

Hypothesis recorded for cross-session durability. **Reconvene week 2, evidence-driven, after week 1 production observations.**
