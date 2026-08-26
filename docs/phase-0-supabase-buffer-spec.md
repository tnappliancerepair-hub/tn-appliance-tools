# Phase 0 — Supabase buffer: "the field app never freezes, a save is never lost"

**Status:** spec / ready to build · **Owner:** Claude + Teddy · **Date:** 2026-08-26
**Trigger:** Xano degraded again (light reads 2–8s vs ~0.3s healthy) → tech app froze
mid-job (Andre), part number wouldn't save. This is the recurring compute-saturation
freeze.

## Goal (one sentence)
Put a **fast, durable Supabase buffer in front of the freeze-prone read + write paths**
so a slow Xano can **never freeze a tech mid-job and never lose a save** — without
migrating any business logic. **Xano stays the source of truth.** This is the relief
step, and every piece carries straight into the full migration if we commit to it.

## Root cause (confirmed today)
- `tech-job.html` reads a job via Xano `get_job_for_dashboard` and saves the TDR/part via
  Xano `create_tdr` — both **direct, synchronous, unguarded**. When Xano is slow the read
  hangs ("Loading…" forever) and the write hangs ("won't save the part number").
- We already proved the fix pattern on the **office board**: `board_mirror` (Supabase read
  replica) + `board-feed-fast` reads it in ~50–100ms with a Xano fallback. Phase 0 =
  **extend that pattern to the tech app + add a durable write path.**

Supabase is separate infrastructure and stays fast/healthy while Xano chokes — that's why
it works as the buffer.

---

## Part A — WRITES never hang or get lost  ⭐ (the Andre fix, highest value, build first)

**Principle:** a save hits **fast Supabase first** (durable, instant), returns success, then
**relays to Xano in the background** with retry. The part number is safe the moment it lands
in Supabase, no matter what Xano is doing.

**Flow:**
1. Tech taps Save → `tech-job.html` writes optimistically to **localStorage** and flips the
   UI to **"Saved ✓"** immediately. The UI never spins on the network.
2. It POSTs to a new **`tdr-save.js`** Netlify function.
3. `tdr-save` writes the TDR row into a Supabase **`tdr_pending`** table (fast, ~50ms) and
   returns `{ok:true}` right away — **the save is now durable.**
4. In the same call (best-effort, time-boxed) it relays to Xano `create_tdr`. If Xano
   answers, mark the row `synced`. If Xano is slow/down, leave it `pending` — **no error to
   the tech.**
5. **`tdr-sync-cron.js`** (every 1–2 min) drains `tdr_pending` where `synced=false` →
   Xano `create_tdr`, retrying until Xano accepts, then marks `synced`. So even a 1-hour
   Xano outage loses nothing — every part number lands when it recovers.

**Status UI:** "Saved ✓" the instant Supabase confirms; a subtle "syncing to office…" chip
until Xano confirms. The tech is never told it failed, because it didn't.

**Files:**
- `docs/sql/010_tdr_pending.sql` — `tdr_pending` table (job_id, tech_id, payload jsonb,
  client_key for idempotency, synced bool, attempts int, created_at, synced_at) + index on
  `(synced, created_at)`.
- `netlify/functions/tdr-save.js` — Supabase insert (idempotent on client_key) → best-effort
  Xano `create_tdr` → return fast.
- `netlify/functions/tdr-sync-cron.js` — drain pending → Xano, retry/backoff, mark synced,
  alert owner only if the backlog ages past N minutes.
- `tech-job.html` (+ any office TDR save) — route Save through `tdr-save`, optimistic local
  save, "Saved ✓ / syncing" status. Reuse the existing `verified_part_number` reliable path.

**Idempotency:** `client_key` (per job+field+timestamp) so a retry can't double-write; the
Xano relay and the cron both no-op on an already-synced key.

---

## Part B — READS never freeze (open a job instantly, even mid-outage)  ✅ BUILT 2026-08-26

**Shipped design (Xano-first, mirror-fallback):** `tech-job.html` paints from its device
cache first (unchanged), then its background refresh goes through **`job-view-fast`** which
tries Xano with a short time-box (fresh when Xano is responsive) and, if Xano is slow/down,
serves the last-good copy from the Supabase **`job_mirror`** — so a read never hangs.
`job-view-fast` warms the mirror on every healthy read; **`job-mirror-sync-cron`** pre-warms
today's active jobs (targets chosen from `board_mirror` = no Xano cost, capped 40/run) so
even a first cold open during an outage is instant. Gated by `JOB_VIEW_FAST` (default off =
pure passthrough to Xano). Files: `docs/sql/011_job_mirror.sql`, `_lib/job-mirror.js`,
`job-view-fast.js`, `job-mirror-sync-cron.js`, netlify.toml, tech-job.html (`getJobFast`).
verifySaved stays on direct Xano (needs source-of-truth, not a possibly-stale mirror).

### Original spec

**Principle:** paint from local cache / Supabase mirror first, use Xano for freshness only
when it's healthy, and **kill every infinite spinner**.

1. `tech-job.html` already has SWR (localStorage paint-first, per v11). Harden it: **every**
   fetch/action gets a hard timeout (≈8s) → on timeout show cached data + a "tap to retry",
   **never a dead "Loading…"**.
2. New **`job-view-fast.js`** — reads the job from a Supabase **`job_mirror`** table (same
   shape the tech app needs: customer, appliance, model, status, tech, latest TDR snapshot,
   attachment refs). Falls back to Xano `get_job_for_dashboard` when the mirror is
   missing/stale and Xano is healthy. tech-job.html loads from this instead of raw Xano.
3. **`job-mirror-sync.js` + `-cron.js`** — keep `job_mirror` fresh (extend the existing
   board-mirror sync, or a light per-job upsert on open). The tech's *own* just-typed edits
   show instantly via the optimistic local paint from Part A, so mirror lag never hides his
   own work.

**Files:**
- `docs/sql/011_job_mirror.sql` — `job_mirror` table + indexes (or extend `board_mirror`).
- `netlify/functions/job-view-fast.js` — Supabase read → Xano fallback.
- `netlify/functions/job-mirror-sync.js` + `-cron.js`.
- `tech-job.html` — read via `job-view-fast`, hard timeouts, no-infinite-spinner guard.

---

## Part C — Shed Xano load (stop it saturating in the first place)
- Confirm all office surfaces read through `board-feed-fast` (Supabase), not raw
  `get_office_kanban`.
- Stagger/thin any remaining heavy crons that hit Xano the same minute (mostly done).
- Net effect: Xano gets headroom back, so the freeze gets rarer even before the mirror
  fully absorbs the traffic.

---

## Out of scope (scope guard — this is NOT the migration)
- No business-logic rewrite. No moving source-of-truth to Supabase. Xano stays boss.
- Phase 0 is purely a **fast, durable buffer** in front of Xano for the read/write paths
  that freeze. Everything is **additive + feature-flagged + reversible**.

## Feature flags (all default OFF, flip on after shadow-run)
- `TDR_DURABLE_SAVE` — route saves through `tdr-save`/Supabase queue.
- `JOB_VIEW_FAST` — tech app reads via `job-view-fast`.
- Kill switch: flip either off → app goes back to direct Xano instantly.

## Timeline — Phase 0: ~1–2 weeks
- **Days 1–3:** Part A (durable writes). **This alone fixes "won't save the part number."**
- **Days 4–6:** Part B (fast reads + no-infinite-spinner).
- **Days 7–10:** Part C load-shed, shadow-run under real field use, verify, flip flags on.

## Rollback / risk
- Every piece flag-gated + additive; Xano remains authoritative, so the mirror/queue can
  **only add durability, never lose data**. If a mirror goes stale or a queue misbehaves,
  flip the flag → direct Xano. Worst case is "back to today," never worse.

## Why this is the right first step
- Stops the exact pain that just hit Andre, in ~1–2 weeks, not 2–4 months.
- 100% reusable in the full migration (the mirror + durable-write layer are Phase 1 of it).
- Same Supabase stack we already run + are selling to shops — no new infrastructure.
