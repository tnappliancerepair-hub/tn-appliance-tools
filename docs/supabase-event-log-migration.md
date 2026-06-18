# Supabase — `event_log` offload (the structural cure for Xano 503s)

**Date:** 2026-06-18
**Why:** Xano keeps getting pinned (instant 503) under write load. The single
highest-churn writer is `event_log` — every signal, action, and audit row. Moving
it to Supabase (managed Postgres) takes the biggest write source off Xano while
**jobs / customers / money stay on Xano untouched.** This is the cloud version of
the `LOOP_STORE=local` SQLite move we already did for the loop's queue.

**Honest scope:** this is a *deliberate* migration (dual-write → verify → cut over),
NOT a 60-second swap, and it should land **when Xano is stable**, not mid-outage
(dual-write briefly adds load). The live-outage lever is the poller load-shed in
`netlify.toml`; this is the durable fix that follows.

---

## 0. One-time setup (Teddy — ~3 min)

1. In Supabase, create a **fresh project dedicated to Ant ops** (keep it clean of
   the bigger-idea build). Region close to us (us-east).
2. Project → Settings → API: copy the **Project URL** and the **`service_role`**
   key (NOT anon — service_role is server-side, bypasses RLS).
3. Put both in the vault via `admin-secrets.html`:
   - `SUPABASE_URL` = `https://<ref>.supabase.co`
   - `SUPABASE_SERVICE_KEY` = the service_role key
4. Supabase → SQL Editor → run the schema in §1.
5. Verify: `…/.netlify/functions/supabase-health?token=tn-supabase-dbg-2026`
   → should show `connected:true` + a successful test insert/read.

`service_role` is full-access — it lives **only** in the vault / server. Never ships
to a browser.

---

## 1. Schema (run in Supabase SQL Editor)

```sql
create table if not exists public.event_log (
  id            bigint generated always as identity primary key,
  action        text not null,
  job_id        bigint,
  customer_id   bigint,
  technician_id bigint,
  company_id    bigint not null default 1,   -- multi-tenant from day one
  metadata      jsonb not null default '{}'::jsonb,
  source        text default 'netlify',
  created_at    timestamptz not null default now()
);

create index if not exists event_log_action_idx     on public.event_log (action);
create index if not exists event_log_job_id_idx      on public.event_log (job_id);
create index if not exists event_log_created_at_idx  on public.event_log (created_at desc);
create index if not exists event_log_company_idx     on public.event_log (company_id);
```

Mirrors the Xano `event_log` shape (`action`, `job_id`, `customer_id`,
`technician_id`, `metadata`, `created_at`) + `company_id` + `source` so office
reads swap with no UI change.

---

## 2. Cutover plan (deliberate, when Xano is stable)

The writers of `event_log` fall in three buckets — migrate by reliability, easiest
first (the ones that DON'T need a Mac/XS push go first):

| Bucket | Who writes event_log | Migrate how | Mac/XS? |
|---|---|---|---|
| **A. Netlify functions** | pollers' wrappers, webhooks, office fns | swap `db.add event_log` HTTP calls → `supabase.recordEvent()` | No — ships via main |
| **B. Colony loop** | `recordEvent` / audit in `xano.js` | point the loop's audit writer at `supabase.recordEvent` (ESM mirror of `_lib/supabase.js`) | No — loop pulls JS |
| **C. Xano XS endpoints** | `db.add event_log {...}` inside intake/action endpoints | replace with `api.request` POST to Supabase PostgREST | Yes — Mac push (the no-op landmine; verify each) |

**Steps:**
1. **Dual-write** (safety): Netlify + loop write event_log to **both** Xano and
   Supabase. Confirm rows match in Supabase for a day.
2. **Cut reads**: point office event-feed reads (office-pulse, owner-activity,
   warranty-review, dedup lookups) at Supabase. Verify pages render.
3. **Drop Xano writes** bucket by bucket (A, then B, then C). Each drop = real
   Xano load reduction.
4. **Keep dedup integrity**: some dedup checks read event_log. Move the check +
   the marker write together so they stay consistent (same lesson as the loop
   cutover — dedup stayed on one store on purpose).

**Rollback:** each bucket is independent. If a bucket misbehaves, re-enable its
Xano write; nothing else is affected.

---

## 2b. Loop dual-write — activation (Mac Mini, one-time)

Status: **wired + flag-gated, default OFF.** `colony-loop/supabase.js` (ESM) +
`colony-loop/xano.js recordEventLog` already mirror every loop event into Supabase
when the flag is on. To activate (Mac Mini, where the loop runs):

1. `git pull origin main` (gets `colony-loop/supabase.js` + the gated dual-write).
2. Add to `colony-loop/.env`:
   ```
   SUPABASE_URL=https://iqpyubevwsaguekujsax.supabase.co
   SUPABASE_SERVICE_KEY=sb_secret_...      # same key as the vault
   SUPABASE_DUAL_WRITE=true
   ```
   (Loop reads these from .env via config.js — NO Xano metadata API involved.)
3. `launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop`
4. Verify: Supabase → Table Editor → `event_log` shows new rows with `source=loop`
   accumulating alongside the Xano writes. Xano is unchanged (still dual-writing).

**Rollback:** remove `SUPABASE_DUAL_WRITE=true` (or set false) → kickstart. Back to
Xano-only instantly.

Once loop rows look right in Supabase for a day, do the read-cut (step 2) + drop the
loop's Xano `record_event_log` write — that's the step that actually sheds load.

## 3. What stays on Xano (on purpose)

Jobs, customers, technicians, money/payroll, warranty_submissions, parts_orders,
app_config (the vault itself) — all business data stays on Xano. This migration is
**only** the high-churn audit/event stream. Same philosophy as the loop cutover:
Xano is fine for business data, wrong as a high-write log/queue.
