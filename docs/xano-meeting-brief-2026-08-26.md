# Xano meeting brief — reduce the saturation freezes (2026-08-26)

Hand this to the Xano team before/at the call so they target our real bottleneck.
Builds on the 2026-08-05 audit brief (`docs/xano-audit-brief-2026-08-05.md`) — read that
too; this is the update after three weeks of mitigation.

## The problem in one line
Under real business-hours load our instance **saturates and requests queue** — light
reads that are ~0.3s healthy climb to **2–8s**, and **writes hang** long enough that the
field tech app can't save a technician's report/part number ("system won't save the part
number", recurring). We need to know **what's actually consuming compute and whether we're
plan-bound**, then make it lean before spending on a bigger tier.

## What's changed since the 8/05 brief (important)
On 8/05 the prime suspect was the office board read (`get_office_kanban`, 3.5–4.3s warm,
8–15s under concurrency). **We've since moved the board OFF Xano** — it's served from a
Supabase read-replica mirror (`board_mirror`), refreshed by one server-side sync per
minute. So N office users now cost **1 Xano read/minute**, not N.

**Yet the instance still saturates and freezes.** That's the key new datapoint: with the
single biggest read removed, the remaining load (the **write path** + our crons/pollers)
is still enough to queue the instance. So the lever is no longer that one query — it's
**overall compute/throughput under concurrent writes**.

## What we measured this week (outside-in; we can't see the inside)
- Light reads during a freeze: **~1.9s, ~2.3s, ~8.3s** on endpoints that are ~0.3s healthy.
- **Write hang:** the tech app's `create_tdr` (save the report/part number) hung past the
  client timeout — the tech saw a spinner and the save appeared to fail. This is the exact
  symptom that keeps hitting us.
- It's **load-correlated**: fine when quiet, degrades when crew + office + crons/pollers
  are all active (business hours, ~13:00–23:00 UTC).

## What we've ALREADY done (please don't just re-recommend these)
- **Board off Xano** — Supabase mirror + edge cache; the heavy kanban read runs once/min
  server-side instead of per user.
- **Killed the per-job N+1** — customer name/phone denormalized onto the jobs row.
- **Composite index** on `jobs (scheduling_status, created_at)`.
- **Staggered the crons/pollers** — the 5 Gmail pollers + sweeps were bursting on the
  same minute marks (that caused 503 spikes); each now fires on its own offset.
- **Durable write buffer (this week)** — tech saves now land in Supabase first and relay
  to Xano in the background, so a slow Xano can no longer *lose* a save. This protects the
  data; it does **not** reduce the load on Xano — that's what this meeting is for.

## Where we're blind — what we need from Xano
1. **Top endpoints by total compute, last 7–14 days.** With the board gone, what's the new
   #1? We suspect the **write path** (`create_tdr` and the intake writes) + the pollers.
2. **Are we compute-bound or plan-bound under load?** Request-queue depth and P95 during
   13:00–23:00 UTC. When light reads hit 8s, is the instance queuing behind writes?
3. **Write throughput / connection limits.** Is there a concurrent-connection or
   write-transaction ceiling on our current plan that we're hitting? What's the ceiling,
   and where are we against it at peak?
4. **`create_tdr` specifically** — what does that write cost (triggers, cascades, indexes
   updated, any synchronous side effects)? Can a report save be made cheap/near-instant?
5. **Index health on `jobs` + the TDR table** — are our indexes being used? Any missing,
   duplicate, or unused indexes making writes expensive?
6. **What actually reduces "instances"/saturation on our setup** — the concrete efficiency
   changes first, and only then, if we're genuinely maxed after those, the right tier.

## The framing we want (please honor)
**Efficiency first, tier last.** We want the specific query/index/write changes that make
us lean at our current plan. A compute/Boost bump is the *last* resort after the writes and
top endpoints are as cheap as they can be — not the opening recommendation. If the data
shows we're truly maxed post-optimization, we'll talk tier with real numbers.

## What we'd love to leave the meeting with
- The top-N endpoints by compute + the one or two that, if optimized, kill most of the
  saturation.
- A concrete read on whether writes are queuing us, and the write/connection ceiling on our
  plan.
- A specific fix (or short list) to make `create_tdr` + intake writes cheap.
- If a tier change is genuinely warranted, the exact metric that justifies it so we can
  verify the payoff.

Contact: James "Teddy" Pivacek · tnappliancerepair@gmail.com
