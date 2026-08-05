# get_office_kanban perf — Mac runbook (staged 2026-08-05)

The office board's feed (`get_office_kanban`) is **3–4s per call** because its `where` is a
7-way `OR` on `scheduling_status` that can't use an index. Under concurrent load it queues
to 8–15s — the "everything's slow today." Today's Netlify fixes (cron stagger + routing 5
pages through the cached `board-feed`) already cut the **concurrency**; this runbook is the
**deeper** fix that makes the base query itself sub-second.

## 0. First — do you still need this?
The concurrency fixes deployed today. Load the board a few times: if it feels snappy now,
this is optional polish. Pursue it only if 3–4s board loads still bug you. It's an
optimization, not a fix for "broken."

## What the change is
The ONLY difference in the candidate is the where clause — the 7-status `OR` becomes an
index-friendly `in [...]`. Everything else is byte-for-byte identical, so both endpoints
MUST return the same jobs. The candidate is a **separate endpoint** (`get_office_kanban_v2`),
so the live board is untouched until we've proven it.

> ⚠️ `in [...]` is NOT proven in our XanoScript (it only appears in comments today). That's
> the whole reason we test it side-by-side instead of editing the live file. If it doesn't
> parse or the rows differ, we discard it — zero risk to the board.

## Steps (≈15 min)
```
cd ~/tn-appliance-tools
git pull origin main

# 1. Push the candidate (new endpoint; live get_office_kanban untouched)
xano workspace push -i "api/**/get_office_kanban_v2*" --force
#    Look for "Pushed 1 documents". If it ERRORS on the `in [...]` syntax → see Fallbacks.

# 2. Prove identical output + compare speed
bash tools/kanban-perf-verify.sh
#    Must print "✅ SETS IDENTICAL" AND v2 runs faster than v1.
```

### Decision
- **✅ IDENTICAL + faster** → promote it. Edit `api/intake/get_office_kanban_GET.xs` line 44:
  replace the `... == "not_ready" || ... || ... == "no_fix_possible"` run with
  `($db.jobs.scheduling_status in ["not_ready","needs_scheduled","scheduled","in_progress","awaiting_parts","held","no_fix_possible"])`
  (keep the `|| ($db.jobs.scheduling_status == "completed" && (...))` tail exactly as-is).
  Then:
  ```
  xano workspace push -i "api/**/get_office_kanban_GET*" --force
  curl -s -o /dev/null -w "%{time_total}s\n" "$XANO/get_office_kanban"   # confirm fast + still 200
  bash tools/kanban-perf-verify.sh   # v1 now == v2, both fast
  ```
  Then delete the throwaway: remove `api/intake/get_office_kanban_v2_GET.xs`, and in the Xano
  UI delete the `get_office_kanban_v2` endpoint. Commit the promoted `get_office_kanban_GET.xs`.

- **❌ SETS DIFFER, or push ERRORED on syntax** → discard. Delete
  `api/intake/get_office_kanban_v2_GET.xs` (and the v2 endpoint in the UI if it got created).
  Live board is exactly as it was. Try a Fallback or leave it — today's concurrency fixes stand.

## Fallbacks if `in [...]` won't parse
1. **`|in:` filter form** — try `where = ($db.jobs.scheduling_status|in:["not_ready", ...])`
   in the v2 file, re-push, re-verify. (Different XanoScript spelling of the same idea.)
2. **Index-merge, no syntax change** — in the Xano UI, add a plain index on
   `jobs.scheduling_status` (if not already present alongside the composite). The planner can
   sometimes OR-merge per-value index lookups. Re-time the live endpoint; keep only if faster.
3. **Accept 3–4s.** With the concurrency collapsed (today's work), a single 3–4s board load
   behind the 75s shared cache is tolerable. This whole item is optional.

## Why this is safe
- v2 is a NEW endpoint — the live board never calls it during the test.
- We diff the actual returned job-id SET (md5 signature), not just trust the push — this
  catches the "push succeeded but silently changed/no-op'd output" XS footgun.
- Promotion only happens after IDENTICAL is proven; revert is a one-line git restore + re-push.
