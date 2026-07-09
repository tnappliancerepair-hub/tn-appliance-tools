# Ant Access Control + Compartmentalized "Desks" — plan (2026-07-09)

**Why:** so TN Appliance can safely add outsourced/offshore staff (and survive a key
employee leaving) — each person gets their own scoped login that shows only their
"desk" and lets them do only their allowed actions. Irreversible / outward-facing
actions (submit a warranty claim, take a payment, cancel a job, mass-text customers)
sit behind a trusted approver (**maker–checker**), and every action is audited.

Teddy's ask (2026-07-09): *"limited access — they can schedule and set up, but not
submit … several different offices for different people who perform different tasks,
compartmentalize things."* This is that.

## Where Ant stands today (what we're changing)
- **Single shared `OFFICE_PASSWORD`** → all-or-nothing office access (`verify_office_password`,
  12h localStorage). Anyone with it sees every customer's PII, the schedule, the invoice
  worksheet, warranty submit, messages.
- **Owner PIN** (tech id 1) via `verify-pin-proxy` for owner-level pages.
- **Per-tech PIN** for tech pages.
- **No per-user identity, no roles, no server-side action gating.** So "schedule but can't
  submit" does not exist yet — it has to be built before an outsider gets a login.

## Principles
1. **Least privilege** — each desk sees/does only what its task needs.
2. **Maker–checker** — money / claims / customer outreach / cancel / delete require a
   trusted checker's final click.
3. **Server-enforced** — permission checks live on the endpoints, not just hidden buttons
   (hiding a button is convenience; the server is the guard — a hidden button is bypassable
   with a crafted request).
4. **Individual accountability** — every login is a real person; every mutating action is
   stamped with the actor and audited.
5. **Data minimization** — limit PII / financial exposure to what the desk needs.
6. **Instant revocation** — deactivate one person without changing anyone else's access
   (never share the master password with an outsider).
7. **Simple** — 3 roles to start, not a maze.

## The desks (v1)
| Desk | Who | Purpose |
|---|---|---|
| **Owner** | Teddy | Everything, incl. money/payroll/P&L, user management |
| **Office / Manager** | Danielle | Full ops + is the **checker** for approvals |
| **Scheduler** | Offshore agent | Schedule + set up + talk to customers — no submit, no money |
| **Warranty prep** *(optional / phase 2)* | Offshore or Danielle | Build claim packages; **submit** stays the checker's click |

(Tech desk unchanged: per-tech PIN.)

## Permission matrix (what each desk can DO)
| Action | Owner | Office | Scheduler | Warranty-prep |
|---|---|---|---|---|
| View schedule board + job basics | ✓ | ✓ | ✓ | ✓ |
| View customer PII (name / address / phone) | ✓ | ✓ | ✓ *(needed to schedule)* | ✓ |
| Book / reschedule appointment | ✓ | ✓ | ✓ | – |
| Assign / reassign tech | ✓ | ✓ | ✓ | – |
| Capture availability / add office notes | ✓ | ✓ | ✓ | ✓ |
| Reply to customer SMS | ✓ | ✓ | ✓ *(or maker→check)* | – |
| Build / prep warranty claim package | ✓ | ✓ | – | ✓ |
| **Submit warranty claim to vendor** | ✓ | ✓ *(checker)* | ✗ | ✗ *(prep only)* |
| **Cancel / delete a job** | ✓ | ✓ | ✗ *(propose only)* | ✗ |
| **Take / record a payment or refund** | ✓ | ✓ | ✗ | ✗ |
| View invoice $ / financials | ✓ | ✓ | ✗ | ✗ |
| View payroll / P&L (owner) | ✓ | ✗ | ✗ | ✗ |
| Manage users / roles | ✓ | ✗ | ✗ | ✗ |

### Maker–checker actions (a trusted approver's final click required)
- Submit warranty claim to vendor (`record_warranty_submission` submit path)
- Record/take a customer payment or refund
- Cancel or delete a job (`office_remove_job`)
- Bulk / mass customer messaging
- Anything a Scheduler "proposes" above their scope → lands in an **Approvals** queue for
  Office/Owner (phase 2; in phase 1 the Scheduler simply can't and hands off).

### What the Scheduler (offshore) sees vs. hidden
- **Sees:** customer name, service address, phone, appliance, problem/symptom, availability,
  schedule/status, assigned tech, parts status/ETA, office notes. (All required to schedule +
  speak with the customer.)
- **Hidden:** payment/card data, invoice totals + financials, payroll, P&L, owner settings,
  bulk export/download.

## The build — components
1. **Identity + roles (data):** a `users` record per person `{ id, name, username,
   pin/password_hash, role, active }`. Reuse the vault/secrets + verify pattern already in use.
   One role per user in v1.
2. **Per-user auth:** login issues a scoped, server-verified session (signed token with
   `{user_id, role, exp}`). Replaces the shared office password for these logins. (Minimal
   revival of the previously-shelved auth work — kept small on purpose.)
3. **Front-end desks:** shared `ant-access.js` → `Ant.role()`, `Ant.can('submit_warranty')`.
   Each page renders only the allowed desk and hides/disables out-of-role actions.
4. **Server-side permission checks (the real guard):** the sensitive endpoints (warranty
   submit, payment, cancel/delete, user management) verify the caller's role and **403** if
   not allowed. Non-negotiable — client hiding is not enough.
5. **Audit:** every mutating action stamps `actor_user_id` + name into `event_log`. Extend
   `owner-activity.html` into an "**activity by person**" view so Teddy can review exactly what
   any user did, any time.
6. **Session controls:** auto-logout; **instant deactivate** (`active=false` kills all their
   sessions); optional IP allowlist for the offshore location; optional working-hours window.

## Rollout phases
- **Phase 1 — MVP for the offshore hire (smallest safe slice):**
  users table + per-user login + role; the **Scheduler desk** (view + schedule + assign +
  notes; PII visible, financials hidden); **server-gate the top-risk endpoints** (warranty
  submit, payment, cancel/delete) to refuse a Scheduler; actor-stamped audit. Danielle + Teddy
  keep full access. → This alone safely enables the offshore scheduler.
- **Phase 2 —** Warranty-prep desk + the **maker–checker Approvals queue**; the owner
  "activity by person" review view; session controls (auto-logout, IP allowlist).
- **Phase 3 — SaaS-aligned:** per-tenant roles (ties into the multi-tenant direction),
  granular per-permission (vs. fixed roles), 2FA for owner.

## What this also fixes / advances
- Closes the "office password client-side / all-or-nothing" hole flagged in the security audit.
- Gives **instant revocation** — the day an outsourced relationship ends, kill their login only.
- **Individual accountability** for outsourced staff (audit by person).
- **Server-side enforcement** so hidden buttons aren't the only guard.
- Doubles as the **"if Danielle leaves, the office still runs on scoped logins"** insurance.

## Open decisions for Teddy
- Should the Scheduler be able to **reply to customer SMS** directly, or maker→check that too?
- Should **warranty claim $ amounts** be hidden from the Scheduler (they don't need them)?
- Start with **3 desks** (Owner/Office/Scheduler) or include **Warranty-prep** in phase 1?
- Enforce an **IP allowlist / working-hours** window on the offshore login from day one?
