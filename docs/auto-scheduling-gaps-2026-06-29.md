# Auto-scheduling — hole audit + status (2026-06-29)

Goal: complete auto-scheduling. This is the end-to-end audit + what's closed vs open.

## ✅ CLOSED today
1. **Universal trigger (the #1 hole).** Auto-place only fired on the warranty
   resume-chat path — cash/Quick-Check, AHS/ServicePower email, and phone-call jobs
   never reached the engine, and there was no sweep. NEW `auto_schedule_sweep` agent
   pulls the needs-scheduled queue (every intake source) and feeds each ready job
   through the same auto-place engine. Flood-safe (autopilot-gated, capped 12/run,
   per-job ~daily dedup, sweep-sourced evals are silent — Teddy reviews via event_log;
   tech still gets the heads-up on a live placement). Scheduled Mon-Sat 8/11/14/17 CT.
2. **Tech profile wired into computeOffer** (hard: days off / hours / stop cap /
   avoided appliances+areas; soft: ideal start) — earlier today.
3. **Interview save fixed** (save-as-you-go + 15-min cap) so profiles actually land.
4. **Live XS deps verified healthy:** list_needs_scheduled_parallel ✓, check_service_zone
   ✓, get_auto_schedule_context ✓ (200 on real job), get_tech_constraints_for_date ✓
   (returns working window + capacity), get-tech-profile ✓. Nothing missing a deploy.
5. **Validation surface:** `auto-place-review?secret=` shows shadow would-place + live
   placed, so the shadow phase is reviewable.

## ⛳ REMAINING (in priority order)

### A. Overbooking race — ✅ GUARD DRAFTED (push at go-live)
`auto_book_existing_job` didn't re-check capacity, so the live sweep could overbook a
tech placing several same-day jobs in one run. **Capacity guard added to
`auto_book_existing_job_POST.xs`** — before booking it re-counts the tech's OTHER real
jobs in the same working day (proposed slot ±11h cleanly isolates one 8a-4p day) and
refuses (precondition) at the system cap of 6; computeOffer's caller already handles a
book failure by falling through. **XS change → Teddy pushes at go-live:**
`xano workspace push -i "api/**/auto_book_existing_job*" --force`. Shadow is unaffected
(no booking), so this can wait until just before `TECH_OFFER_LIVE`.

### B. Route-density clustering — ✅ DONE
computeOffer now collects up to the first 6 valid days and **rides the earliest day the
tech is ALREADY working** (his stops that day are in his cluster → groups the route,
saves a dedicated trip); falls back to the soonest valid day if none. Bounded to the
first 6 options so the customer is never pushed far out for density. (Ships with the loop
deploy — JS, no XS push.) Future upgrade: true per-stop geographic proximity (needs a
day's-stops-with-zips endpoint); count-based clustering is a solid proxy given
cluster-based tech routing.

### C. Last-stop routing (enhancement)
Profile captures `last_stop_where/why`, but computeOffer only sets the day + a start
time, not intra-day sequence. Honoring "end my day near home/school" needs a
resequencer over the day's stops. Post-launch.

### D. Flag → auto-reschedule (exception path)
The 🚩 flag texts Ant (tech line); today it notifies, it doesn't auto-move the job.
Closing the loop = parse the flag → unschedule + re-place avoiding the conflict.
Exception handling; fine to be human/Ant-assisted at first.

## To go from here → live
1. Deploy the loop (Mac): `git pull origin main && launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop`
2. Run the tech interviews (profiles are the input).
3. `TECH_OFFER_ENABLED=true` → SHADOW. Watch `auto-place-review?secret=...` for a few days.
4. Close hole A (capacity guard), then `TECH_OFFER_LIVE=true` → live (optionally one tech first).
