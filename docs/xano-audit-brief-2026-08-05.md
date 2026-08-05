# Xano efficiency audit — briefing for Cassie (2026-08-05)

Hand this to Cassie so the audit targets our real bottleneck instead of rediscovering it.
Our own outside-in measurements below; what we can't see (query plans, index usage,
per-endpoint compute, request-queue depth) is exactly what we need from the Xano side.

## The one hot spot: `get_office_kanban`
This is the office board feed. It's the thing that makes "everything feel slow."

**Measured (warm, single request):** 3.5–4.3s.
**Under concurrency (6 parallel):** 8–15s — it queues. Individual requests look fine, so
the pileup only shows under real load (crew + office devices + crons hitting it at once).
**Control endpoints are healthy:** `get_job_for_dashboard` ~0.3s, light event-log reads
~0.55s. So it's specific to this query, not the whole instance — until the queue starves
everything sharing compute.

**What the query does:**
- `db.query jobs` with `where = scheduling_status == "not_ready" || ... (7 statuses) || (scheduling_status == "completed" && (job_completed_at >= cutoff || created_at >= cutoff))`
- `sort = {created_at: desc}`, `per_page: 800` (returns ~701 rows today)
- then per-row shaping in a foreach

## What we've ALREADY optimized (please don't re-recommend these)
- **Killed the per-job N+1** — customer name/phone are denormalized onto the jobs row; a
  `db.get customer` fires only when the denorm is blank (rare).
- **Composite index** on `jobs (scheduling_status, created_at)` already added.
- **Edge cache** — a Netlify proxy (`board-feed`) caches the feed 75s shared across all
  office users; we also route 5 more office pages through it and staggered the crons that
  call it so no two heavy sweeps run the query at the same minute. (This tamed the
  concurrency; the base 3–4s is what's left.)

## What we tried that did NOT work
- Rewrote the 7-way status `OR` as `scheduling_status in [...]` (a side-by-side test
  endpoint). It **parsed**, but (a) it was **not faster** (4–7.7s), and (b) it returned a
  **different set** — 800 rows (hit the cap, over-matching) vs the OR's 701. So `in [...]`
  doesn't evaluate equivalently to the OR here, and isn't the lever.

## Questions for the audit (where we're blind)
1. **Why doesn't the 7-status `OR` (+ the completed/date clause) use the composite index?**
   Can this predicate be made index-friendly without changing the result set? What's the
   correct Xano pattern for "status in a small fixed set OR (completed AND recent)"?
2. **Where does the 3–4s actually go** — the filter scan, the sort, or materializing/
   returning 800 wide rows? (Query analyzer / EXPLAIN on `get_office_kanban`.)
3. **Are we compute-bound or query-bound under load?** Request-queue depth + P95 during
   business hours (13–23 UTC). If it's queuing, is it the plan or the tier?
4. **Any other per-endpoint compute hogs** we haven't spotted? Top endpoints by total
   compute over the last 7–14 days.
5. **`in [...]` semantics** — why did it over-match (800 vs 701)? Is there a supported
   array-membership operator that both indexes AND matches exactly?
6. **Index health** — are the indexes we added actually being used? Any missing/duplicate/
   unused indexes on `jobs`?

## The framing (please)
We want **query/index efficiency first** — that's the durable fix and keeps cost flat.
A compute/Boost bump is the last resort *after* the query is as lean as it can be, not the
first recommendation. If the audit shows we're genuinely maxed after optimization, we'll
talk tier — but let's exhaust efficiency first.

## What we'd love back
- The query analyzer output for `get_office_kanban` + the specific index/predicate change
  to make it sub-second (with identical results).
- Top-N endpoints by compute, and any index recommendations.
- A read on request-queue depth under our real concurrency.

Contact on our side: James "Teddy" Pivacek · tnappliancerepair@gmail.com
