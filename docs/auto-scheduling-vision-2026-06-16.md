# Auto-Scheduling Vision — the "dispatcher who listens" (captured 2026-06-16, ~midnight CT)

This doc captures the scheduling model worked out with Teddy. It replaces the dread of
"build a perfect optimizer" with a model that is **measurable, adjustable, and grows into
great.** Baseline proven the night this was written: **76% tech-agreement, untuned.**

## The reframe (why it stopped feeling impossible)
Don't build a perfect week-optimizer (that's the NP-hard vehicle-routing problem — the wrong
target). Build what a great dispatcher actually does: answer ONE question, fast, over and
over — **"For THIS job, who's the obvious tech + day, and is it obvious enough to not need a
human?"** Auto-scheduling = doing that one decision repeatedly and auto-accepting only when
confident.

## The mechanism: filter on HARD, score on SOFT, then decide confidence
- **HARD constraints (invalid if violated):** tech covers the zip's cluster · tech available
  that day (not off, under max stops) · parts arrived / ETA passed (`parts_eta_date`) · tech
  handles that brand/appliance (specialties/exclusions) · warranty vendor day window.
- **SOFT preferences (score the survivors):** tech already has same-cluster stops that day
  (route density — biggest weight) · tech's preferred day/hours · job age/urgency · owner is
  last resort.
- Filter → score → take the top → **rate confidence.** It's a scoring function (~150 lines,
  reason-about-able), NOT an optimizer.

## Confidence tiers (how trust is earned — this kills the dread)
1. **Shadow (built — `schedule-shadow.html` / `schedule-shadow.js`):** re-run the suggester
   against jobs a human already scheduled; report agreement %. **Watch the number.**
2. **Auto the easy ones:** one obvious tech for the cluster + he's already out that day + parts
   ready → auto-book, tell Danielle "booked Jimmy Thursday, tap to change." Ambiguous → 2-3
   options to her.
3. **Widen the auto band** as agreement proves out. Never a single "full auto" switch.
- **Danielle always has final say.**

## Offer-to-techs (Teddy's key reframe — solves the hard 24%)
Jobs the algorithm CAN'T confidently place are not failures — they're **offers.**
- **Coverage gap** (area has no/over-full tech) → Ant offers the work to eligible/interested
  techs: *"Hey John, 2 jobs in Baton Rouge Thursday — want them?"* First to tap claims it.
- **Rank-1 full that day** → offer to rank-2, then broadcast.
- Matches the philosophy: **mutual, nobody dictating** — techs opt into work they want.
- Already-owned parts: broadcast/claim flow, `grab.html` tap-to-claim, tech geo prefs.

## Coverage depth scales with volume (#2 in busy areas)
Coverage isn't static. Quiet area = 1 tech; busy area needs a **#2** (then #3) so one guy
maxing out isn't a bottleneck. Uses the existing **cluster ranks** (`set_cluster_rank`,
Area Coverage page). The new part: **don't set depth by hand — let data flag it.** Watch each
cluster's volume vs. ranked-tech depth and surface: *"TN Metro: 18 jobs/wk, 1 ranked tech →
needs a #2"* / *"Baton Rouge: volume, 0 ranked → needs coverage."* That flag becomes the offer.
→ Build next: **coverage-depth report** (per area: volume + depth + needs-#2 / needs-coverage / healthy).

## The learning layer (the moat) — gather data subtly, never interrogate
Techs ignore forms and resent interviews. Ant gathers everything as a byproduct of being
friendly + helpful, layered on the natural workday:
- **Morning:** light small talk in the briefing (logs preferences).
- **Midday:** recognition — *"nice, that Samsung's done already, you're quick on those."*
- **Running ahead (`tech_pace_watcher` already detects this):** *"you're flying — want a couple
  Baton Rouge stops on the way home?"* → over time: *"you keep running ahead out west — want
  Baton Rouge as a regular area?"* The capacity moment IS the coverage-expansion moment, framed
  as a compliment, never an order.
- **Behavior > surveys:** which areas a tech finishes fast, where he lingers, what he declines,
  when he runs ahead — actions reveal preference better than any form. Watch the work, add light
  conversation on top.
- **Why it's the moat:** anyone can copy an algorithm; nobody can copy 6 months of Ant quietly
  learning each tech. The relationship IS the data, and it compounds.

## "Adjust the scoring as we grow"
The soft-preference weights are **dials**, not a fixed formula. The shadow agreement rate is the
feedback loop: each week, look at the misses → nudge a weight or fix a data hole → rate climbs.
The system grows into great; it does not have to launch great.

## What already exists (the pieces — this is assembly, not invention)
`check_service_zone` (zip→cluster→suggested rank-1 non-owner) · `get_tech_route_days` ·
`suggest-schedule.js` (ghost day pick) · `tech_pace_watcher` (running ahead/behind) ·
`grab.html` + scheduling_queue broadcast (tap-to-claim) · cluster ranks (`set_cluster_rank`,
`cluster-ranks.html`) · tech prefs (preferred hours, days-off, geographic_strategy/"great day",
brand exclusions, max stops) · **`schedule-shadow` (the agreement-rate harness, built tonight).**

## First moves (in order)
1. **Map the 17 uncovered ZIPs** the shadow flagged → agreement jumps.
2. **Coverage-depth report** → see where a #2 / coverage is needed → drives offers.
3. **Eyeball the 61 mismatches** → real disagreements vs tunable weights.
4. **Auto-accept the high-confidence band**; offer the rest; Danielle keeps final say.
5. Wire the **offer-to-techs** flow (gap/overflow → text eligible techs → tap-to-claim → books).
6. Layer the **subtle learning** onto morning briefing + pace watcher.

Baseline the night this was written: **76% untuned tech-agreement, 17 zip holes, 0 "no ranked
tech" (cluster ranks are solid).** The hard problem was mostly a confidence problem.

## ⭐ NORTH STAR (Teddy, 2026-06-16) — read this before building anything here
The intelligence isn't about scheduling. **It's about solid communication with the team.**
That's the most important variable — how well it's done determines whether techs LOVE working
with us. Better communication → easier days → more opportunities → they live their lives more
effectively → better careers with us. Good techs are the scarce resource in this industry; a
shop techs love to work for wins on every axis (retention, recruiting, quality, growth, customer
experience). Every scheduling/offer/learning feature is in service of THIS. Measure each build
against: "does this make a tech's day easier and the communication better?" If not, reconsider.

### The key: MANAGING the information correctly (Teddy, 2026-06-16)
Communication is the output; managing the information correctly is the engine. "Correctly" =
the RIGHT info, to the RIGHT person, at the RIGHT time, in the RIGHT amount (signal, not noise —
over-communicating tunes techs out as badly as under-communicating). It must flow from ONE truth
(the single job record), never re-entered, never scattered. Ant's core job is filtering the
firehose down to exactly what each role needs to know or do. Chain: manage info correctly →
communicate the right thing → tech's day gets easier → tech thrives → business thrives.
