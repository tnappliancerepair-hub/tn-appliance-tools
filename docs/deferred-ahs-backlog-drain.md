# Deferred — Limited AHS backlog drain (2026-05-28)

## Status: DEFERRED-KILLED

The "limited drain: recent + active warranty AHS backlog" task is removed from the active task list and parked here.

## Decision

No backfill of historical AHS-source jobs into the parallel intake stream. Going forward only — pre-activation timestamp (`PARSER_ACTIVATION_TS_MS` env var) gates the parallel `create_job_from_email` endpoint to reject anything older than the flip moment.

## Why

1. The 16,677 AHS jobs sitting at `scheduling_status=not_ready` were inherited from the legacy poll pipeline. Backfilling them into the parallel system would re-trigger `try_auto_schedule` per job and flood Teddy with thousands of "ready to schedule" SMSes.
2. None of those 16,677 jobs has a `customer_preference_text` value (verified via the AHS backlog audit, 2026-05-27 session log). So the `--require-pref` filter on `backfill-ahs-scheduling.js` correctly excluded them.
3. With the parallel ANT system handling intake from this point forward, the legacy backlog will naturally drain as customers re-engage (resume-chat) or the jobs age out / get manually closed by Danielle from her queue.
4. The pre-vacation hardening priority is making Danielle self-sufficient on NEW intake, not litigating the existing pile.

## What this means in practice

- `colony-loop/scripts/backfill-ahs-scheduling.js` stays in the repo but should NOT be run.
- `list_ahs_backlog_GET` endpoint stays available as a diagnostic.
- Danielle can still surface individual stale jobs via her `/needs-scheduled` page if she chooses.
- If a future business decision reverses this, re-open the task — but the default is no backfill.

## When to revisit

After HCP cutover validation is complete (Phase 1 ant-only lifecycle proven) AND the warranty submission flow is fully automated, we can re-evaluate whether historical AHS jobs are worth reactivating. Not before.
