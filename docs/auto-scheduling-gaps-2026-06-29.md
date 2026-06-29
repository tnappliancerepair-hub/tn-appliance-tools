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

### A. Overbooking race — the one real PRE-LIVE hole 🔴
`auto_book_existing_job` does NOT re-check capacity before booking. If the live sweep
places multiple jobs for the SAME tech+day in one run, each computeOffer can see the
same `existing_job_count` and all book → over the cap. **Not a shadow problem** (no
booking). **Fix before flipping `TECH_OFFER_LIVE`:** add a capacity precondition to
`auto_book_existing_job_POST.xs` — re-count that tech's jobs in the day window and
refuse (success:false) if at/over `max_jobs_per_day`; computeOffer's caller already
handles a book failure by falling through. (XS change → Mac push. Drafted carefully
when we're at go-live; until then shadow is safe.)

### B. Route-density clustering (enhancement, not a blocker)
computeOffer picks the FIRST open day that fits constraints — not the day that best
DENSIFIES the tech's existing route. Teddy's vision is "cluster customers onto the days
the tech is already out there." v1 (first-fit) is fine to launch; clustering is a
quality upgrade: prefer a day where the tech already has nearby stops.

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
