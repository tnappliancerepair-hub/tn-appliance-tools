# `lookup_by_claim_number` — fields to add (warranty CSC phone fix)

`lookup_by_claim_number` lives ONLY in Xano (not in the repo), so this is a
copy-paste spec to apply in the Xano UI. It's the 95%-of-calls fix: warranty
companies (AHS/ServicePower) call asking "have we been out? is it scheduled?
what's the status?" — Ant can only answer if the lookup returns these fields.

## What it already does (per CLAUDE.md 2026-06-03)
Searches a claim/WO number against `claim_number`, `dispatch_source_id`,
`job_number`, `housecall_pro_job_id`, and `id`. Good — finding the job works.
The gap is what it RETURNS about the job.

## Add these to the job object it returns
In the response/job block (mirror how `lookup_customer_by_phone` builds its
`job_row`), make sure the matched job returns:

| field | source | lets Ant say |
|---|---|---|
| `scheduling_status` | `($job.scheduling_status ?? "")` | completed = "the tech completed it on [day]"; scheduled = "it's on the schedule"; awaiting_parts = "tech's been out, waiting on a part" |
| `scheduled_start` (or `_ct` formatted) | `$job.scheduled_start` | the scheduled DAY |
| `tech_first_name` | `db.get technicians` by `$job.technician_id` → first_name | which tech |
| `parts_status` | `($job.parts_status ?? "")` | "waiting on parts" |
| `parts_eta_date` | `($job.parts_eta_date ?? "")` | "part expected around [date]" |
| `appliance_type` + `brand` | `($job.appliance_type ?? "")` / `($job.brand ?? "")` | confirm the right job |
| `job_completed_at` | `($job.job_completed_at ?? null)` | "completed on [date]" |

## XS snippet to drop into the response job object
(adjust the var name `$job`/`$j` to match what the endpoint already uses)
```
scheduling_status : (($job.scheduling_status ?? "")|trim)
scheduled_start   : ($job.scheduled_start ?? 0)
parts_status      : (($job.parts_status ?? "")|trim)
parts_eta_date    : (($job.parts_eta_date ?? "")|trim)
appliance_type    : (($job.appliance_type ?? "")|trim)
brand             : (($job.brand ?? "")|trim)
job_completed_at  : ($job.job_completed_at ?? 0)
tech_first_name   : $tech_first   // from a db.get technicians on $job.technician_id (see lookup_customer_by_phone for the exact pattern)
```

## Footgun reminders (XS)
- No em-dashes anywhere.
- `??` / `|trim` only inside `value = (...)` — i.e. inside the object literal value, fine.
- First row of a paginated `db.query`: `(($rows.items|first) ?? null)`.
- Deploy via the Xano UI paste OR Mac CLI `xano workspace push` — NOT the Metadata API.

## After applying
Test: call from a warranty number, give a claim/dispatch #, and confirm Ant can
say the status + scheduled day + whether we've been out. That closes the loop on
the bulk of inbound calls.
