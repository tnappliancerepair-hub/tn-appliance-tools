# Job State Machine

Single source of truth for legal job states + allowed transitions.

Implementation: `transition_job_state_POST.xs` validates every change.
All other endpoints that touch `scheduling_status` are migrated to call
this one over the Phase 1 refactor window.

## States (14)

| State | Meaning | Terminal? |
|---|---|---|
| `not_ready` | Job exists but missing prerequisites (e.g., no customer pref) | no |
| `needs_more_info` | Specific info-gathering step blocked | no |
| `prediagnosis_pending` | Waiting for owner / tech pre-diag TDR | no |
| `intake_complete` | All info gathered, ready for scheduler | no |
| `intake_complete` | Sitting in queue waiting for tech assignment | no |
| `broadcasting` | Offered to multiple qualified techs, waiting for a claim | no |
| `scheduled` | Tech + time assigned | no |
| `awaiting_parts` | Held — parts ordered, will resume when arrive | no |
| `held` | General hold (customer travel, contractor delay, etc.) | no |
| `in_progress` | Tech has started the visit | no |
| `escalated` | Needs human judgment | no |
| `completed` | Tech finished, TDR submitted | yes (terminal) |
| `no_fix_possible` | Diagnosed unfixable | yes (terminal) |
| `canceled` | Aborted (customer, vendor, sick day, etc.) | yes (terminal — but admin can reopen) |

## Legal transitions

| From → To | Triggered by | Side effects on entry |
|---|---|---|
| `not_ready` → `needs_more_info` | system | none |
| `not_ready` → `intake_complete` | customer reply, system | emit JOB_INTAKE_COMPLETE |
| `not_ready` → `canceled` | office, system | emit JOB_CANCELED, customer+tech SMS (gated) |
| `needs_more_info` → `intake_complete` | system | emit JOB_INTAKE_COMPLETE |
| `needs_more_info` → `canceled` | office | emit JOB_CANCELED |
| `prediagnosis_pending` → `intake_complete` | owner TDR | emit JOB_INTAKE_COMPLETE |
| `prediagnosis_pending` → `canceled` | office | emit JOB_CANCELED |
| `intake_complete` → `intake_complete` | system | none |
| `intake_complete` → `canceled` | office | emit JOB_CANCELED |
| `intake_complete` → `broadcasting` | scheduler | enqueue broadcast |
| `intake_complete` → `scheduled` | scheduler, office | emit APPOINTMENT_SCHEDULED, customer SMS (gated), tech SMS |
| `intake_complete` → `canceled` | office | emit JOB_CANCELED |
| `broadcasting` → `scheduled` | tech CLAIM, owner PICK | emit APPOINTMENT_SCHEDULED, customer SMS (gated), tech SMS |
| `broadcasting` → `intake_complete` | broadcast expired | none |
| `broadcasting` → `canceled` | office, expiry | emit JOB_CANCELED |
| `scheduled` → `in_progress` | tech Start | emit JOB_STARTED, customer SMS (gated, "tech is here") |
| `scheduled` → `awaiting_parts` | tech pre-arrival parts call | emit PARTS_ORDER_DUE |
| `scheduled` → `held` | customer reschedule, weather, etc. | optional customer SMS |
| `scheduled` → `canceled` | office, customer | emit JOB_CANCELED, customer SMS (gated), tech SMS |
| `awaiting_parts` → `scheduled` | parts arrived + rebooking | emit APPOINTMENT_SCHEDULED |
| `awaiting_parts` → `canceled` | office | emit JOB_CANCELED |
| `held` → `scheduled` | office | emit APPOINTMENT_SCHEDULED |
| `held` → `canceled` | office | emit JOB_CANCELED |
| `in_progress` → `awaiting_parts` | tech mid-visit | emit PARTS_ORDER_DUE |
| `in_progress` → `completed` | tech Complete | emit JOB_COMPLETED, FOLLOWUP_DUE, INVOICE_DUE (self-pay), warranty digest (warranty) |
| `in_progress` → `no_fix_possible` | tech | emit JOB_COMPLETED (with no_fix marker), customer SMS (gated) |
| `in_progress` → `escalated` | tech, system | emit JOB_ESCALATED, owner SMS |
| `escalated` → `scheduled` | office resolution | none |
| `escalated` → `canceled` | office | emit JOB_CANCELED |
| terminal states (`completed`, `no_fix_possible`, `canceled`) | (no further transitions in normal operation) | admin can force-revert via `force_revert` flag |

## Validation rules

- `actor` must be one of: `tech`, `office`, `customer`, `system`, `scheduler`, `vendor`, `admin`
- Transitions FROM terminal states require `force_revert: true` + `actor: admin`
- Transition payload may include `scheduled_start` (ms), `technician_id`, `reason` text
- `scheduled` entry requires either `technician_id` already set OR present in payload
- `completed` entry requires at least one TDR row to exist for the job
- Every transition writes one `event_log` row with action=`job_state_transition`
  and metadata `{from, to, actor, reason, payload}` — enables full lifecycle replay

## Why this matters

**Today** (pre-refactor): 34 XS files write scheduling_status directly. Each
has its own (sometimes broken) idea of what's a legal next state. Most don't
emit any signal. Means:
- Inconsistent customer/tech notifications
- Jobs ending up in impossible states (we saw "broadcasting" jobs with no
  scheduled_start today)
- Audit trail incomplete

**After refactor**: every status change goes through ONE endpoint that
validates + writes the audit + emits the right signals. Means:
- North-star outcomes (reliability for tech, clarity for customer) become
  enforceable at write time, not "hope the right side effects fire"
- Lifecycle analytics ("how long between scheduled and arrival?") become
  one event_log query
