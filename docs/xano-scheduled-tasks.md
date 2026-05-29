# Xano scheduled tasks — current inventory (2026-05-28)

Xano scheduled tasks live in the Xano UI (Tasks panel), not in this repo. This doc is the operator-side record of what's currently configured + their gating env vars.

## hcp_poll_recent_jobs

- **Endpoint:** `POST /api:3e_TffpA/hcp_poll_recent_jobs`
- **Cadence:** every 15 minutes (per endpoint header comment)
- **Purpose:** pulls HCP jobs updated since last poll, upserts into Xano (Phase 1 inbound read-only source)
- **Live state (2026-05-28):** task fires on schedule but is gated **OFF** at the endpoint level.
  - Calling endpoint returns: `{success:true, skipped:true, reason:"disabled"}`
  - Gate: env var `HCP_POLL_ENABLED` is currently unset (or `false`) in Xano
- **To re-enable** (per Teddy's morning directive — keep HCP as inbound read-only source):
  - Xano UI → Settings → Environment Variables → set `HCP_POLL_ENABLED=true`
  - No restart needed; next 15-min task fire will start polling
- **Audit:** endpoint writes event_log rows with action `hcp_poll_completed` (success), `hcp_poll_run` (start), `hcp_poll_inserted`, `hcp_poll_updated`, `hcp_poll_reassign`, `hcp_poll_api_error`, `hcp_poll_misconfigured`, `hcp_poll_skipped_disabled`. As of 2026-05-28 19:30 CT, zero rows in last 24h → confirms the task is currently disabled.
- **What polling unlocks:** HCP-side updates (tech tap "I'm at the job" in HCP) flow into Xano so the Ant calendar + dashboards reflect them. This is the only way HCP-origin work gets to Ant today.

## Other scheduled tasks (TBD)

If other Xano scheduled tasks exist, they should be documented here. Operator: run `Tasks` panel in Xano UI to enumerate. Most colony loop scheduling lives in `colony-loop/tick.js` (Mac Mini side), not Xano tasks.

---

**Why this doc exists:** task #9 — "Identify Xano scheduled task running hcp_poll_recent_jobs." Identified: it's a 15-min Xano cron task; currently silenced via env var; flip the gate when ready to bring inbound HCP back online.
