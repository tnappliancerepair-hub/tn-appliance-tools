# HCP Cutover Playbook — Saturday Cut Plan

Target: cut HCP off the critical path by end of Saturday. Plan written 2026-05-27 morning after dry-run verification.

---

## Reality check (verified 2026-05-27 10:30 CT)

- ✅ **Migration script works**: dry-run pulled 10 real HCP open jobs in 829ms, zero failures
- ✅ **HCP_API_KEY** already in `colony-loop/.env`
- ✅ **Only 10 actual HCP open jobs** to migrate (the 937 in Xano are legacy linked entries; HCP itself only has 10 in scheduled/in_progress)
- ✅ **All 5 cutover prereqs functionally built** (calendar, tech-complete-without-HCP, customer auto-confirm, broadcast booking, office booking flow)
- ⚠️ **Readiness checker says 2 false** because it looks for event_log action names that don't match the actual emits — not a real blocker, but I'll fix it Day 1
- ⚠️ **5 XS endpoints still PUSH to HCP** (create_tdr, create_job, add_tdr_note, 2 poll-pushers) — need `HCP_PUSH_DISABLED` env flag wired before cut

---

## Day 1 — TODAY (Tuesday)

1. **Wire `HCP_PUSH_DISABLED` env flag** into the 5 push endpoints. When `true`, they skip the api.request to HCP but otherwise complete normally. Operator flips on cutover morning.
2. **Fix the readiness checker** so all 5 prereqs report green based on the actual event names being emitted.
3. **Validate one full job lifecycle end-to-end with HCP polling DISABLED on a test job:**
   - Create a job via book_appointment_from_office (no HCP call)
   - Tech opens tech-ant-live → session bootstraps → chat works
   - Tech taps Complete → status flips, audit logs
   - Warranty digest fires for Danielle (Phase 5A)
4. **Identify the Xano scheduled task** that runs `hcp_poll_recent_jobs` (operator will toggle it OFF on cutover morning).

## Day 2 — Wednesday (rehearsal)

5. **One tech runs a full day on Ant-only** — no HCP. Watch for any flow that breaks because HCP-state is expected but absent.
6. **Full migration dry-run** with the entire HCP open-job set. Diff against Xano. Reconcile any unmapped jobs.
7. **Train Teddy on the 3-button cutover sequence:**
   - `HCP_PUSH_DISABLED=true` (Xano env)
   - Disable Xano scheduled task for hcp_poll_recent_jobs
   - Run `node colony-loop/scripts/hcp-migration-import.js` (live, no --dry-run flag)

## Day 3 — Saturday (cut)

8. **8:00 AM** — Verify loop GREEN. Verify office-pulse shows recent activity. Verify health-check.html is live.
9. **8:15 AM** — Set `$env.HCP_PUSH_DISABLED=true` in Xano. (One-click in Xano UI.)
10. **8:20 AM** — Disable Xano scheduled task `hcp_poll_recent_jobs` in Xano UI Tasks tab.
11. **8:30 AM** — Run `node colony-loop/scripts/hcp-migration-import.js` (LIVE). Watch the run. Should be <60 seconds for 10 jobs.
12. **8:35 AM** — Verify in Xano that the 10 imported jobs landed correctly (created_at = now, housecall_pro_job_id set, customer matched).
13. **8:40 AM** — Pull up office-calendar.html. Confirm the 10 imported jobs show on the appropriate dates/techs.
14. **9:00 AM** — Open `office-pulse.html` + watch for 2 hours. Any `signal_error` or `loop_error` events → SMS me immediately.
15. **Through the day** — handle any inbound HCP webhook calls if they still fire (webhook endpoint becomes a no-op once `HCP_PUSH_DISABLED=true` is set + poll task is off).

## Rollback (if cutover breaks anything Saturday)

A. Re-enable the Xano scheduled task for `hcp_poll_recent_jobs`.
B. Set `$env.HCP_PUSH_DISABLED=false`.
C. Migrated jobs stay in Xano with their `housecall_pro_job_id` linkages — no data loss.
D. Operator manually reconciles any jobs created in Ant-only mode (source_type='office_ant') back to HCP if needed.

Rollback window: ~5 minutes total. Low-risk cutover.

## What DOESN'T need to happen Saturday

- ❌ DNS changes — Netlify domain stays
- ❌ Customer SMS migrations — Telnyx + colony loop already canonical
- ❌ Tech retraining — all 6 techs already familiar with tech-ant-live + tech-daily-dashboard
- ❌ Customer notifications — auto-flows continue
- ❌ Office password rotation — V3 already moved it server-side
- ❌ Mass data migrations — only 10 HCP open jobs to import

---

## Open questions for Teddy

1. **Which day are we cutting?** (Saturday is the planned day; confirm)
2. **Is there a specific morning hour you want to start?** (defaults to 8:00 AM CT)
3. **Anyone else need to be online during cut?** (Danielle for warranty checks?)
4. **Are any jobs currently in HCP that you DON'T want imported?** (cancelled, ancient, etc — filter before cut)

🐜 Long Live Ant.
