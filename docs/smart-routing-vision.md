# 🏆 SMART ROUTING — the greatest achievement (Teddy, 2026-06-14)

"This idea will be our greatest achievement when we have it working correctly."
Two halves: smart cluster scheduling (the base) + dynamic route-fill (the magic).

## The model: schedule by DAY + AREA, never a clock time
- Customers are booked for a **DAY**, not a time.
- **Smart cluster routing picks the tech + day:** the job goes to whoever runs
  that zip's cluster, on the day that best fits the existing route, so the truck
  isn't crisscrossing town. Jobs batch geographically.
- The **morning of**, the customer gets a text with a **live arrival window**
  once the tech starts his route.
- **No specific time is promised — unless absolutely necessary** (a warranty
  homeowner who insists). Then we can give a window; if they push hard, escalate
  to Teddy. (The office tools already reflect this: tech-for-the-area + day,
  time hidden, window "only if they really need one.")

## Part 1 — Smart cluster scheduling (the foundation)
Ant auto-suggests, the office confirms:
- **zip → cluster → tech.** From the job's service_zip, find the cluster and the
  tech who owns it. Pre-pick that tech (Danielle just confirms instead of guessing).
- **best day = lightest/closest route.** Suggest the day where that tech already
  has stops near this zip (densify the route, don't scatter it).
- **batch view:** "Jimmy has 4 stops in 37013 Thursday — add this one there."
- One-tap accept → booked → customer auto-confirmed (no time, day-of window).

Build-on-what-exists: `check_service_zone` (zip→cluster), the zones table
(technician_id per zone → cluster→tech), `danielle_schedule_parallel_job`,
the needs-scheduled backlog, drive-time/geocode (`get-drive-time`).

## Part 2 — Dynamic route-fill (the magic) 🎯
**When a tech is running AHEAD of his day, Ant offers him nearby open work.**
- Detect "ahead": tech completing stops faster than planned (job_completed_at vs
  the day's remaining stops / typical durations), or a gap before the next stop.
- Ant texts the tech: *"You're ahead, Jimmy 🐜 — 2 open jobs within 10 min of you:
  #18537 Carson (washer, Antioch) and #18602 Lee (dryer). Want me to add one to
  today? Reply 1, 2, or no."*
- Tech replies → Ant slots it onto his day, books it, **texts that customer** a
  live window. A waiting customer gets served *today*, the truck-hour is used,
  and it's one fewer trip another day.
- Pull candidates from: unscheduled/open jobs near the tech's current zip
  (proximity via zip/geocode), prioritized by age + cluster fit.

## Part 2b — THE ULTIMATE TECH PARTNER (live, bidirectional, both ways)
Ant is the tech's real-time dispatch partner — proactive AND on-demand, managing
the day as it actually unfolds, and handling all the customer comms both directions:

- **Running AHEAD → pull work forward.** Ant notices (or the tech asks: "who's
  near me?") and offers nearby open/available customers: "2 within 10 min — want
  one?" Tech says yes → Ant messages that customer, books it, gives a live window.
- **Running BEHIND → protect the later stops.** Ant notices the day slipping and
  **proactively messages the upcoming customers** — "running a little behind, now
  looking like early afternoon, still good?" — adjusts windows, offers to move
  anyone who can't wait. The customer never sits wondering; the tech never has to
  stop and make calls.
- **Either party can start it.** Ant nudges the tech, or the tech texts/talks to
  Ant ("I'm ahead, pull someone close" / "I'm behind 45 min, push my afternoon").
  Maximizes the AI: Ant does the routing math, the proximity lookups, and the
  customer messaging in real time so the tech just drives and fixes.

This is "the ultimate tech partner" — a live co-pilot that fills slack when fast,
cushions customers when slow, and keeps the whole day optimized without anyone
touching the office.

## Why this is the achievement
- **First-visit-fix + jobs-per-day climb**, trucks stop crisscrossing → lower cost.
- **Customers served faster** (today, not next week) → the self-pay-parity goal.
- It's the routing brain HCP/MeisterTask never had — fully automated, conflict-free
  (everything through Ant), and it compounds: more data → better suggestions.

## Phased build
1. **Cluster-suggest** (now): Ant pre-picks the tech by zip on the Do-Next /
   Phone-Ready / schedule flows. Office confirms with a tap.
2. **Route-aware day suggestion:** suggest the day that densifies the tech's route.
3. **Dynamic route-fill agent:** "running ahead → here are 2 nearby open jobs →
   want one?" tech-facing, real-time. Colony-loop agent + tech SMS reply handler.
4. **Full auto:** with the self-checkout TDR flow, jobs flow in pre-diagnosed and
   the router places + fills them with near-zero office touch.

Sequence after the core cutover (Danielle + techs living in Ant daily).
