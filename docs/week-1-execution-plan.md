# Week 1 Execution Plan — placeholder

**Created:** 2026-05-09 (end of session, pre-execution).
**Purpose:** Tomorrow's session focuses on the fastest path to having the existing dormant systems running in production. This file will be filled in during that session.

---

## Goal

Prove the theory in production. Flip the gates one at a time, observe what breaks, capture friction points for week 2 architecture decisions.

---

## Anticipated agenda

1. **`SMS_ENABLED` kill-switch** — build first, before any other gate flip (per Decision 6 in `docs/system-blueprint-decisions-2026-05-09.md`)
2. **Customer transparency SMS workstream** — build the four new triggers (Teddy started, parts ordered, parts shipped, parts delivered with DIY/Install branches), gated by `SMS_ENABLED`
3. **TCR clearance handling** — when TCR clears, flip `SMS_ENABLED=true`, walk a real customer through the journey, capture friction
4. **`TECH_ASSIST_ENABLED` flip** — walk one tech through a real job
5. **`SCHEDULING_QUEUE_ENABLED` flip** — start with one cluster / one tech, watch broadcasts fire
6. **End-of-week observation pass** — what worked, what didn't, what surprised

---

## Pre-flight checks needed before tomorrow

- Vapi dashboard inventory of 8 unverified agents (per Decision 2)
- Verify TCR clearance status (campaign `CM2e229065885a4147ca062158c1f62f0f`, day 1 of estimated 3-4 day cycle)
- Confirm system prompt env var saved correctly in Xano `$env.SYSTEM_PROMPT` (per Teddy's confirmation 2026-05-09)
- Review homepage Quick Check pitch + Stripe checkout copy + intake waiver text for "no refund — honest assessment" framing (per Decision 5 verification action)

---

## Status

Placeholder. To be filled in during tomorrow's session.
