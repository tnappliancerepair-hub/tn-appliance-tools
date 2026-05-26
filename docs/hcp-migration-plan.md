# HCP Migration Plan — Cutover Saturday

**Status**: draft. All 5 cutover prerequisites must be GREEN before picking the Saturday. See `CLAUDE.md` "HCP migration day" for the live prereq tracker. As of 2026-05-26, prereqs 1-4 are DONE and prereq 5 (Ant Office booking flow) just landed in this commit.

---

## Day-of cutover playbook

**T-7 days** — schedule the cutover for a Saturday with the lightest live schedule. Notify all 6 active techs in the roster. Confirm Danielle / Alyse are reachable Saturday morning.

**T-2 days** — run the diagnostic:

```bash
curl -s "https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/get_hcp_migration_status?lookback_days=60" \
  | python3 -m json.tool
```

This returns:
- Total Xano jobs created in the last N days
- HCP linkage split (with `housecall_pro_job_id` vs. without)
- Scheduling status breakdown (open / scheduled / completed / canceled / not_ready)
- Source type breakdown (hcp / ahs_email / servicepower / warranty / office_ant / web_chat / other)

**Then probe HCP directly** for the canonical open-job count (Xano cannot do this — HCP is the canonical source until migration):

```bash
# From Netlify shell or any tool with HCP_API_TOKEN access
curl -s -H "Authorization: Bearer $HCP_API_TOKEN" \
  "https://api.housecallpro.com/jobs?work_status=scheduled,in_progress,schedule_appointment&page=1&per_page=200" \
  | jq '.total_count'
```

**The gap** between HCP's open count and Xano's `hcp_linkage.with_hcp_id` for open statuses is the migration backlog — those jobs need to be backfilled into Xano before HCP is decommissioned.

**T-1 day** — final dry-run import using `hcp_backfill_recent_jobs_POST.xs` (the existing backfill endpoint) against a 7-day window. Confirm it idempotently no-ops on jobs already in Xano.

**Migration Saturday morning**:

1. **08:00 CT** — freeze HCP. Set up an automated bounce or have Danielle manually post in the team Slack: "HCP is read-only until cutover complete. Use Ant Office for new bookings."

2. **08:15 CT** — run the full migration script (see "Migration script outline" below). Expected runtime: ~5-15 min depending on backlog size. Watch the `event_log` for `hcp_migration_imported` rows and any errors.

3. **09:00 CT** — verify in Ant Office: every open HCP job should now appear in `office-calendar.html` with the right tech / date / scheduling_status. Spot-check 5 jobs end-to-end against HCP.

4. **09:30 CT** — disable the two HCP-driven Xano endpoints that mutate state: `hcp_job_webhook_POST.xs` and the `hcp_poll_recent_jobs` Xano scheduled task. (Don't delete — keep them parked for a week as a safety net. Disable the task in Xano UI; the webhook can stay live but HCP will stop sending events once the integration is removed in step 5.)

5. **09:45 CT** — log into HCP and disable / remove the integration on their side (webhook URL, API key rotation). This is the irrevocable step.

6. **10:00 CT** — announce "HCP retired" in the team Slack. Make sure all 6 techs are using `tech-daily-dashboard.html?tech_id=N` for their schedule, not HCP.

7. **Throughout Saturday** — monitor `event_log` for `office_ant_job_created` rows (proves new bookings are flowing through the new path) and `appointment_scheduled_signal_emitted` rows (proves customer confirmations are firing).

---

## Migration script outline

Run as a one-off Node script from `/Users/tpivacek/tn-appliance-tools/scripts/` (NOT a recurring Xano task). The script:

1. Page through HCP `/jobs` API with `work_status` filter for open statuses (scheduled, in_progress, schedule_appointment, schedule appointment).
2. For each HCP job, check if Xano has a matching row by `housecall_pro_job_id`. If yes — skip (idempotent). If no — proceed.
3. Resolve / create the customer in Xano:
   - HCP returns a nested `customer` block. Match on phone (Xano `customer.phone`).
   - If no match, create a new `customer` row.
4. Insert the `jobs` row with the field map below.
5. **Do NOT emit `APPOINTMENT_SCHEDULED`** for migrated jobs — the customers already received their HCP-side confirmations. We only need them on the calendar.
6. Write an audit row to `event_log` with `action: "hcp_migration_imported"` + the HCP job_id and resulting Xano job_id.

### Field map (HCP API → Xano `jobs` columns)

| HCP field | Xano `jobs` column | Notes |
|---|---|---|
| `id` | `housecall_pro_job_id` | The link key. |
| `job_number` | `job_number` | Human-readable label. |
| `work_status` | `scheduling_status` | Mapped via the existing `hcp_poll_recent_jobs` enum-mapper logic (extract that into a shared helper). |
| `customer.id` | (used to resolve `customer_id`) | Match-by-phone first, fallback create. |
| `customer.first_name`, `customer.last_name`, `customer.mobile_number` | Customer row fields | |
| `service_address.street`, `.city`, `.state`, `.zip` | `service_address`, `service_city`, `service_state`, `service_zip` | |
| `schedule.scheduled_start` | `scheduled_start` | Convert ISO → unix ms. |
| `schedule.scheduled_end` | `scheduled_end` | Same. |
| `assigned_employee_ids[0]` | `hcp_assigned_to` + map to `technician_id` | Use the same HCP-pro-id → tech-id mapping currently in `hcp_poll_recent_jobs`. Surface ambiguities into `event_log`. |
| `description` | `problem_summary` | If empty, use `notes` or `work_status_description`. |
| `total_amount` | `quoted_total` | Cents → dollars conversion. |
| `tags[]` | (filter for warranty company names) | If a tag matches `AHS`, `SquareTrade`, `Frontdoor`, `Cinch` — set `customer_type="warranty"` + `warranty_company=<match>`. Otherwise `customer_type="self_pay"`. |
| `notes` | `notes_internal` | Free-form. |
| `source_type` | `source_type` | Set to `hcp_migration_import` so we can audit-trace. |
| `intake_source` | `intake_source` | Set to `hcp_migration_import`. |

Anything not in this map: log to `event_log` metadata as `unmapped_fields` so we have a paper trail if a customer asks about something a tech can't find post-cutover.

### Rollback plan

- The HCP webhook URL stays registered for 7 days post-cutover. If migration goes wrong, point HCP back as canonical and re-enable the `hcp_poll_recent_jobs` task — Xano starts re-pulling.
- The migration script itself is idempotent (key is `housecall_pro_job_id`), so it can be safely re-run.
- Any office bookings made via `book_appointment_from_office_POST` between 08:00 and rollback are flagged with `source_type="office_ant"` and are easy to identify if they need to be replayed into HCP after rollback.

### Edge cases to watch

- **HCP customer with no phone**: skip the job, log to `event_log`, leave for manual reconciliation.
- **Multi-pro jobs**: HCP can assign multiple employees. Take `assigned_employee_ids[0]` and log the others to `event_log` metadata. Manual reassignment in Ant Office post-cutover.
- **Recurring jobs**: HCP supports recurring schedules; Xano doesn't (yet). Import the first occurrence only and log the recurrence config to `event_log` for manual handling.
- **HCP-side jobs already canceled but still in the API**: filter on `work_status` to exclude canceled / cancelled / pro_canceled / pro_cancelled / declined.

---

## Post-cutover monitoring (first 2 weeks)

- Daily: query `event_log` for `hcp_migration_imported` to confirm zero late stragglers (any rows after Saturday means HCP is still active somewhere).
- Daily: confirm `office_ant_job_created` count tracks expected booking volume.
- Weekly: probe HCP API one more time to make sure no rogue jobs were created there post-cutover.

Once 2 weeks pass clean, delete the HCP integration permanently (rotate webhook URL, revoke API key, archive `hcp_job_webhook_POST.xs` and `hcp_poll_recent_jobs_POST.xs` to a `legacy/` folder).
