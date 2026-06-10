# Scheduler go-live runbook (home Wed eve → flip Thu/Fri)

Timeline (Teddy, 2026-06-09): home Wednesday early evening → deploy → flip the
scheduler Thursday/Friday with a day to watch it. Everything below is staged +
committed on `claude/good-morning-TcydP`. Keep Wednesday light; the real flip is
Thu.

---

## PHASE 1 — Wednesday evening (~15 min, low-energy OK)

Just deploying. No flip yet. Goal: get the XS endpoints live so they're ready
overnight.

**Deploy these 4 `.xs` files** (Xano UI paste, or `xano workspace push` on the
Mac Mini — NOT the Metadata API, it drops xanoscript). Priority order:

1. **`api/intake/transition_job_state_POST.xs`** ← THE CRITICAL ONE. Adds
   `not_ready / prediagnosis_pending / needs_more_info / scheduled → scheduled`.
   Without it the scheduler's writes keep bouncing.
2. `api/intake/danielle_schedule_parallel_job_POST.xs` — routes Danielle's
   scheduling through the state machine + fires APPOINTMENT_SCHEDULED.
3. `api/intake/merge_call_note_into_problem_summary_POST.xs` — NEW; customer
   voice → TDR pre-fill (404s until published).
4. `api/intake/record_scheduler_shadow_run_POST.xs` — fixes 0-drive reporting.

Mac Mini one-liner:
`xano workspace push -i "**/transition_job_state*" -i "**/danielle_schedule_parallel_job*" -i "**/merge_call_note_into_problem_summary*" -i "**/record_scheduler_shadow_run*" --force`
(ignore "table does not exist" cache warnings; curl each to confirm 200.)

**Phone items to close while you're at it (if not already done):**
- Tap `forward=vapi` if customer calls are still hitting cells.
- 615-280-2949 port: once it's landed in Telnyx, point it at Ant Inbound
  (`forward=vapi&numbers=+16152802949` or attach to the Voice App).

---

## PHASE 2 — Thursday AM — verify the writes actually land

**Tell Claude: "re-run the placement probe."** Claude checks recent jobs for
`not_ready → scheduled` transitions + `PRACTICE_<date>` tags after a cron tick.
- ✅ If `not_ready` jobs are flipping to `scheduled` and getting PRACTICE-tagged
  → the bounce is fixed, proceed to Phase 3.
- ❌ If still bouncing → Claude diagnoses (deploy didn't take / another guard).
  Do NOT flip until placements are confirmed landing.

---

## PHASE 3 — Thursday — flip to TECHS-ONLY real

This is a **small code change Claude builds once Phase 2 is green** (not
pre-built blind — it depends on verifying the deployed scheduler works). The
flip:
1. Stop tagging placements `PRACTICE_<date>` (so they're real, not badged).
2. Make the assigned tech get the confirmation SMS (so the excited techs
   actually see their auto-scheduled day).
3. **Customer SMS gate stays OFF** (`CUSTOMER_FACING_ENABLED=false`) — techs
   only, no customer messages yet.
4. Flip it on, then watch.

**The one thing to watch:** TN Metro overflow. Routes are clean (tight clusters,
0 unrouted, sane drive) but Teddy maxes at 6 jobs/day in Metro and spills over.
That's capacity, not a bug — decide whether Teddy stays the metro tech or metro
needs a second body.

---

## PHASE 4 — Friday — watch + widen

- Monitor event_log + the techs' real reactions to auto-scheduled days.
- If clean after a day, decide on widening — and separately, whether/when to
  flip `CUSTOMER_FACING_ENABLED` for parallel-mode jobs (customer confirmation
  SMS). That's its own decision, after techs-only proves out.

---

## Quick reference — Claude handoffs

- After Phase 1 deploy → "re-run the placement probe"
- Phase 2 green → "build the techs-only flip"
- Anything weird → paste the symptom; the watchdogs + event_log make it
  diagnosable fast. (The 1% lives here — small blast radius by design.)
