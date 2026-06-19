# 🎯 SELF-SCHEDULING AUTOPILOT — THE PLAN (saved 2026-06-19, Teddy's locked vision)

**This is the main idea for self-scheduling. Build toward exactly this. It supersedes the older "3 options to the owner" / PICK1/2/3 model — that idea is RETIRED.**

## North star
Jobs schedule themselves. **The TECHNICIAN is the decision-maker.** Teddy (owner) is pulled in **ONLY** when no tech will accept, or there's a genuine exception. Ant does all the thinking and hands the tech one clean, route-smart offer to confirm.

## The flow (exact — this is how we want it)
1. **New job arrives.** The customer's availability is collected (the availability cascade → `customer_preference_text` AVAIL/UNAVAIL, or portal grid).
2. **Ant computes the single BEST placement itself** — zip → cluster → the best tech → the day that tightens that tech's existing route → a stop position in his day — **while honoring the customer's stated availability.**
3. **Ant texts THAT TECH a one-tap offer:** *"This fits your Thursday cluster — [area], your 5th stop. Will that work? Reply YES to take it."*
4. **Tech taps YES → the job books itself** onto his day → the customer automatically gets a confirmation + live window. The tech is the decision-maker.
5. **The owner is involved ONLY on failure/exception** — nobody accepts, or availability can't be met, or a real conflict. Never in the routine path.

## Design principles
- **Best single offer, not a menu.** Ant picks the optimal slot; the tech just confirms. No three-options-to-anyone.
- **Route-smart.** The day/slot is chosen to tighten the tech's existing cluster route — fewer miles, fuller truck, same-day density.
- **Customer availability is a real constraint.** Hard constraints (times they truly can't do) are honored absolutely; soft preferences are optimized around. The placement must read AVAIL/UNAVAIL.
- **Keep the owner out of the routine.** Escalate to Teddy only on no-accept / exception.
- **Tech-friendly.** One tap. Clear context (area, day, which stop). Respect existing guards (weekend mute, allow-list, SMS gates, breaker).
- **Xano-safe.** New per-job scheduling writes stay modest / local where possible (we just fixed a Xano melt — do NOT reintroduce a per-job write-flood).

## What's already built (REUSE — don't rebuild)
- **Tech one-tap offer → accept → auto-book → customer confirm:** the route-fill system — `grab.html` + the booking chain + `APPOINTMENT_SCHEDULED` → `appointment_scheduled.js`. Today it only fires when a tech is running *ahead*; we make it the primary new-job path.
- **Best-tech + route-smart day:** `check_service_zone` (returns `suggested_technician_id`), `get_tech_route_days`, `find_extra_work_for_tech`, `cluster_assignment` ranks.
- **Customer availability collection:** the availability cascade (`job_created` greeting ask → +2h nudge → +5h Vapi call → `sms_response_availability` → `customer_preference_text`; plus portal grid + office manual entry via `set-job-availability`).

## The GAP (what to build)
1. **Trigger the tech-offer for EVERY new job** (today route-fill only fires for ahead techs).
2. **Make day/slot selection HONOR `customer_preference_text` AVAIL/UNAVAIL** — today the routing logic ignores it. This is the key missing link.
3. **Offer → accept → escalate state machine:** offer to the cluster's rank-1 tech → on no-answer/decline within a window, re-offer the next-ranked tech → only after the ranked techs pass does it escalate to the owner.
4. **Replace `job_intake_complete`'s "text owner 3 options" / earliest-slot auto-book** with "make the tech a route-smart offer."

## When the owner IS involved (the only times)
- No tech in the cluster accepts the offer after the ranked walk.
- The customer's availability can't be satisfied by any tech's route within reason.
- A genuine error/conflict/exception.

## 🧭 THE TEDDY TOOL IS THE COCKPIT (Teddy's unifying idea, 2026-06-19)
The tech offer isn't just an SMS off in the ether — it gets a **home and a face inside the Teddy Tool** (`teddy-tdr-tool.html`), tying the whole pipeline together in one view.

- As the customer's intake lands in the Teddy Tool (machine info + video + model + pre-diagnosis), **the computed tech offer is surfaced right there**: "Ant recommends **Jimmy · Thursday · slot 5** — fits his cluster + the customer's availability. Offer sent ✓ / Accepted ✓."
- **The offer rides on top of the pre-diagnosis.** The tech receives a *pre-diagnosed* job — video, model, likely part attached — not just "a job." That's the *best possible offer*: he knows what he's walking into before he says yes.
- **It is a WINDOW into the autopilot, not a required step.** The offer still **auto-fires to the tech by default** (owner stays out of the routine per the north star). The Teddy Tool panel just *shows* what Ant did (who was offered, accepted/declined, booked) and gives a **one-tap override lever** if Teddy wants to step in. He's watching it work, not pressing send.
- **The Teddy Tool becomes the single cockpit** for a job's whole life: intake → diagnose → offer → accept → booked — the unified-workspace vision made real. Ties directly into `docs/self-checkout-vision.md` (the self-checkout intake feeds this cockpit).

**Build impact:** piece #3 (Tech one-tap offer) gains a visual surface — a "Scheduling" card in `teddy-tdr-tool.html` that reads the same `TECH_JOB_OFFER` / offer-record state: shows Ant's recommended tech + day + slot + the *why* (cluster fit + customer availability), live offer status, and an override. Read-only mirror of the autopilot; never a gate on it.

## 🧱 THE THREE SCHEDULING CONSTRAINTS (build the skeleton around these)
The "earliest day we can offer the tech" = **the LATEST of:**
1. **Parts ETA** — when the part will be delivered (Marcone API → `parts_eta_date`). Never offer a day before the part arrives. *(North Star — wire when Marcone ETA is live; `parts_eta_date` already exists on parts jobs.)*
2. **Customer availability** — the days/times they said work (the `availability.js` parser — BUILT). *(v1)*
3. **Tech route + capacity** — a day the tech has room + cluster density (`check_service_zone`, `get_tech_route_days`, `getTechConstraintsForDate`). *(v1)*

**Design rule:** the slot-picker takes a **LIST of constraints**, not a hardcoded one — so adding parts-ETA later is "add a constraint," not a rewrite. Don't paint into a corner.

## 🚦 PHASED ROLLOUT (Teddy's call, 2026-06-19 — keep it simple, prove it first)
**v1 — THIS WEEK (prove the loop):**
- Plain **SMS offer to the tech** → accept → auto-book → customer confirmed.
- Honors **customer availability** + tech/cluster routing.
- **NO Teddy Tool surface, NO parts-ETA gating yet.** Just prove the core mechanic works end to end. Shadow (`TECH_OFFER_LIVE=off`, texts owner what it would do) → then live.

**North Star — AFTER v1 is proven:**
- Offer surfaces **in the Teddy Tool cockpit**, riding on the pre-diagnosis.
- Timing becomes **parts-ETA-aware** (Marcone) — offer day is after the part lands at the customer.

## Status
- Availability collection: built + hardened (2026-06-19).
- **Availability parser (`colony-loop/availability.js`) — BUILT + tested 12/12 (2026-06-19). The keystone.**
- This doc = the build target. Component inventory + exact gap mapping done 2026-06-19 (see session log).
