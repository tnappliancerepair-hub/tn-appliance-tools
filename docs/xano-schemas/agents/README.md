# Agent-supporting XS endpoints (paste-ready)

Created 2026-05-29. Seven GET endpoints that activate dormant agents in Colony 10 (Office Efficiency) and Colony 4 (Intelligent Scheduling).

Each is footgun-clean: no em-dashes, no backticks, every filter paren-wrapped. Balance-checked.

## Paste workflow (Xano UI)

1. Xano UI → API tab → `intake` group → "+ Add API Endpoint" → XanoScript editor
2. Use the verb + name from the filename (e.g. `list_calendar_conflicts_GET.xs` → verb GET, name `list_calendar_conflicts`)
3. Paste the file contents, save, publish
4. Smoke-test in the Xano "Run" panel before wiring any agent to consume it

## What each one unlocks

| File | Agent it supports | Colony | What it returns |
|---|---|---|---|
| `list_calendar_conflicts_GET.xs` | OF005 Calendar Conflict Detector | 10 | Overlapping appointments per tech (within 1h of each other) |
| `list_stuck_jobs_GET.xs` | OF011 Stuck Job Watcher | 10 | Non-terminal jobs not updated in N days |
| `list_jobs_by_status_GET.xs` | (generic helper) | 10/4 | Jobs filtered by scheduling_status + optional intake_source |
| `get_reschedule_patterns_GET.xs` | OF004 Reschedule Pattern Analyzer | 10 | Jobs with >N reschedules in window |
| `list_same_day_candidates_GET.xs` | S028 Last Minute Filler | 4 | Flexible/self-pay jobs near a zip prefix |
| `get_capacity_forecast_GET.xs` | S030 Capacity Predictor | 4 | Per-tech headroom for next N days |
| `get_office_touchpoint_audit_GET.xs` | OF003 Office Touchpoint Audit | 10 | Office actions + SMS volume by day/action |
| `get_drive_time_gaps_GET.xs` | S009 Gap Calculator (+S012, S021) | 4 | Tech's day in geometry form for downstream drive-time math |

## Filter-related caveats

Three endpoints use XS filters I haven't personally verified are in this Xano workspace:
- `|push:`, `|set:`, `|get:` (object/array mutation) — used by all
- `|date_format:`, `|datetime_to_ms:` — used by capacity_forecast, drive_time_gaps, touchpoint_audit
- `|starts_with:` — used by same_day_candidates

If any are missing, the Xano UI will surface a clear "Unable to locate func entry: <name>" error on save. The fixes are mechanical (pre-bind via additional vars or a different filter chain).

## Architectural note

These are XS data primitives. The actual agent logic (Claude prompts, signal emission, decision routing) lives in `colony-loop/agents/*.js` — already built by the Colony Architect, just dormant. After these endpoints land, the agents need three more things to go LIVE:
1. An upstream signal producer that fires `SCHEDULE_REQUEST_<NAME>` signals
2. A `colony-loop/xano.js` client method for each endpoint (wraps the fetch)
3. A consumer wire from the agent into the appropriate JS xano helper
