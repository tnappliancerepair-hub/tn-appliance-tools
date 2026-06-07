# Action list — deploy + verify (saved 2026-06-07, Teddy in FL ~3 days)

Everything below is **committed + pushed** to branch `claude/good-morning-TcydP`.
The code is done. What remains is **deploying the XanoScript endpoints** (the
`.xs` files do NOT auto-deploy — Metadata API drops xanoscript, so they need
Xano UI paste OR `xano workspace push` on the Mac Mini). The `.js` files already
auto-deployed via Netlify.

---

## 🔴 PRIORITY 1 — the self-scheduling unblock (do this first)

**Deploy `api/intake/transition_job_state_POST.xs`** (Xano UI paste or
`xano workspace push -i "**/transition_job_state*" --force` on the Mac Mini).

- **Why it matters:** this is THE fix. The auto-scheduler routes `not_ready`
  jobs to `scheduled`, but the state machine forbade that transition, so every
  placement was silently bouncing (0 of 40 recent jobs carried the PRACTICE tag
  the scheduler should stamp). This change adds `scheduled` as a permitted
  target from `not_ready`, `prediagnosis_pending`, `needs_more_info`, and
  `scheduled` (self, for reschedule).
- **After it's deployed:** tell Claude "re-run the placement probe." Claude
  re-runs the live check — if `not_ready` jobs start flipping to `scheduled`
  with a `PRACTICE_<date>` tag on the next 15-min cron tick, **self-scheduling
  is verified and ready for the techs-only flip.**

> Phone-doable? The Xano UI paste works in a mobile browser but pasting a long
> endpoint is rough. If you can, do this one tonight; the other three can wait
> for the Mac Mini.

---

## Deploy queue — remaining 3 `.xs` files (when back / Mac Mini)

| File | What it unblocks |
|---|---|
| `api/intake/danielle_schedule_parallel_job_POST.xs` | Danielle's scheduling now fires customer+tech confirmation SMS AND routes through the validated state machine (was a silent direct write). |
| `api/intake/merge_call_note_into_problem_summary_POST.xs` | NEW endpoint. Inbound customer call summaries merge into `jobs.problem_summary` so the tech's TDR pre-fills from what the customer said on the phone. (`vapi-webhook.js` already calls it — it 404s until this is published.) |
| `api/intake/record_scheduler_shadow_run_POST.xs` | Efficiency report stops showing 0 drive-minutes (was dropping `drive_total_minutes` + `overflow_total`). Reporting-only — no rush. |

Mac Mini one-liner for all four:
`xano workspace push -i "**/transition_job_state*" -i "**/danielle_schedule_parallel_job*" -i "**/merge_call_note_into_problem_summary*" -i "**/record_scheduler_shadow_run*" --force`
(ignore "table does not exist" cache warnings; curl each endpoint to confirm 200.)

---

## After deploy — verification (Claude can do these, just ask)

1. **Placement probe** — confirm `not_ready` jobs flip to `scheduled` + PRACTICE-tagged after a cron tick. → green light for techs-only self-scheduling.
2. **Danielle scheduling** — book a job from `needs-scheduled.html`, confirm the transition succeeds + confirmation SMS fires.
3. **Customer-voice merge** — after an inbound call matched to a job, confirm `jobs.problem_summary` got the call note appended.

---

## Self-scheduling go-live (decision parked, after verify passes)

The route quality is already good (clean clusters, 0 unrouted, sane drive times).
The recommended flip sequence:
1. Drop the `PRACTICE_` tag + let tech SMS fire → **techs-only real**, customer
   gate stays OFF.
2. Watch one real day.
3. If clean, flip `CUSTOMER_FACING_ENABLED` for parallel-mode jobs.

**Open question for you:** TN Metro is the bottleneck — Teddy maxes at 6 jobs/day
and still spills over (9 overflow on the busiest day). Decide whether you stay the
metro tech once live, or metro needs a second body.

---

## Still pending from this morning (not today's work, but open)

- **Publish `tech_assist_chat_v2`** in Xano UI — gates Andre's TDR-autofill retest
  on job 18581 (CLI push succeeded, route 404s until UI-published).
- **RingCentral 615-280-2949** — re-forward to 866-268-0111 + kill the stale
  "phone system broken" voicemail (or just wait for the **6/8 Telnyx port**, the
  permanent fix).
- **Google Business Profile** → update to 866-268-0111.

---

## Not blocking (P2, logged)

- **TDR fragmentation (#3):** a job has multiple TDR rows; readers take newest.
  Self-correcting in the normal case. Optional hardening: have "latest TDR"
  readers prefer the newest row with a non-empty `diagnosis`. No rush.
