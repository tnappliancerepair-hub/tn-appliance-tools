# Deferred — Phase 2b conflict resolution (2026-05-28)

## Status: SHELVED

Phase 2b — move existing jobs that violate newly-set tech preferences (e.g. tech now declares "no Saturday work" but has a Saturday job already on the books). Removed from the active task list.

## Why

1. **Low signal-to-noise.** Most preference changes in practice are forward-looking; the conflict universe is small enough that Danielle can resolve case-by-case faster than the system can propose-and-confirm.
2. **Higher risk than reward.** Auto-moving a booked job to honor a new preference touches a confirmed customer appointment. Customer SMS would have to fire (currently blocked by CUSTOMER_FACING_ENABLED=false). Even with consent, it adds churn during a period where stability matters more than optimization.
3. **The conflict-resolution UX is not free** — needs a propose-N-options flow, customer reschedule SMS, owner approval. That's a feature, not a polish item, and competes with the chat-first tech UI which moves more revenue.
4. **No tech is currently asking for this.** Phase 2a (preference capture) ships value the day it's set; Phase 2b is a hypothetical "but what about historical conflicts" answer that wasn't part of the tech intake.

## What stays in place
- Phase 2a is live (SMS-first scheduler with preference capture).
- Future bookings already honor tech preferences via `try_auto_schedule` + `find_open_slots_for_job`.
- Manual conflict resolution remains in Danielle's hands (office-calendar manage modal, reschedule_job_POST endpoint).

## When to revisit
After the chat-first tech UI is in production and stable AND the scheduler has 4+ weeks of preference-honoring data. If a real volume of stale-preference conflicts emerges, re-open this with a customer-consent flow design.
