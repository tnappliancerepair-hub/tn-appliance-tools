# Scale-Hardening Plan — ANT Platform (Supabase)

**Purpose:** make sure the ANT Platforms Supabase never repeats the Xano crashes as we grow to
100+ shops. Xano choked on a fixed compute ceiling + N+1 queries + being misused as a message
queue — and when it choked we were *stuck* (no-code, no levers). Supabase is raw managed
Postgres: it scales fine at our volume, but only if we don't repeat those mistakes and we keep
headroom. This doc is the one-time hardening pass + the ongoing **weekly review**.

**Target load (the "100 shops" scenario):** 100 shops × ~100 stops/week ≈ **10,000 jobs/week ≈
43,000/month ≈ 520k/year**, ~30–50 rows/job across all tables ≈ **~20M rows/year**. That is
*small* for Postgres — row count is not the risk. Compute headroom, query hygiene, connection
pooling, and monitoring are. Runway is thousands of shops on one well-run instance + a replica.

Owners: **[C] = Claude/dev** · **[T] = Teddy (billing/settings/keys)**.

---

## A. One-time hardening pass — do before ~50 shops

- [ ] **1. Connection pooler (biggest real risk).** Route *all* serverless functions + browser
      clients through Supabase's pooler (Supavisor, transaction mode) — never direct Postgres
      connections. Serverless + direct connections = connection exhaustion = the classic crash.
      Verify our function DB access + the browser `supabase-js` client use the pooled endpoint. [C]
- [ ] **2. Index audit.** Confirm an index on every hot filter/sort column across the platform
      tables: `company_id`, `status`, `job_id`, `stop_id`, `customer_id`, `unit_id`, `created_at`.
      Add composites where the board/queries filter+sort together: `(company_id, status)`,
      `(company_id, created_at desc)`. (We've been adding these per-migration — audit the whole set.) [C]
- [ ] **3. RLS caching.** Every policy calls `current_company_id()` / `current_app_role()`. Wrap
      them as `(select public.current_company_id())` inside the policy so Postgres evaluates them
      **once per query, not once per row** (known Supabase scaling gotcha). Confirm the resolver
      functions are `STABLE SECURITY DEFINER` and that `company_id` is indexed on every table. [C]
- [ ] **4. Statement timeout.** Set a per-role `statement_timeout` (e.g. 8s for `authenticated`,
      15s for service role) so one runaway query dies instead of hanging the whole instance. [C]
- [ ] **5. Per-tenant rate limiting.** Cap requests/min per `company_id` at the Netlify-function
      layer so one noisy shop (or a bug) can't hammer the DB for everyone. [C]
- [ ] **6. Media offload — verify.** Photos → Supabase Storage, video → Cloudflare Stream. Confirm
      nothing large (no base64 blobs) is written into Postgres rows. *(Already the design — just verify.)* [C]
- [ ] **7. Backups / PITR.** Turn on **Point-in-Time Recovery** on the ANT Platforms project
      (Supabase Pro). A worst case becomes a *restore*, not lost client data. [T]
- [ ] **8. Right-size compute.** Pick the instance tier with real headroom (not Nano — that's what
      crashed ANT OPS). Record the current tier here + the trigger to bump it (§C thresholds). [T]
- [ ] **9. Monitoring + alerts.** A health reader (CPU / memory / disk-IO / connection count / slow
      queries / DB size) + an alert when any crosses ~70%. Reuse the `db-size-check` pattern from
      ANT OPS, pointed at the Platforms project. [C builds reader · T vaults the service key]
- [ ] **10. Graceful degradation — verify everywhere.** The client must stay usable through a slow
      moment: try-with-fallback selects, fetch timeouts, durable-save + drain-mirror. Confirm across
      cockpit / office board / portal / intake. *(Largely in place — audit for gaps.)* [C]
- [ ] **11. Load test.** Simulate ~100 shops of realistic traffic (board polls + tech saves +
      intake writes + realtime) against a **staging** Supabase. Record where it strains and which
      tier clears it. Turns "I hope it holds" into "we measured it holds." [C]

Current compute tier: _______ · PITR on: ☐ · Pooler verified: ☐ · Load test done: ☐

---

## B. Weekly review — ~10 minutes, every Monday

Pull these and compare to the thresholds in §C. If anything is over, do the fix **that week**.

1. **Compute headroom** — peak CPU / memory / disk-IO over the last 7 days. Under ~70%?
2. **Connections** — peak connection count vs pool size.
3. **Slow queries** — top offenders from `pg_stat_statements`. Any new N+1 or missing index?
4. **DB size + growth** — total size, biggest tables, rows added/week. Any table where
   dead tuples > live (autovacuum falling behind)?
5. **Storage + Stream** — Supabase Storage usage and Cloudflare Stream minutes/cost.
6. **Errors** — any 5xx / timeouts in the functions or the client fallbacks firing a lot.
7. **Shop count + trajectory** — active shops, peak calls/min, jobs/week — is growth about to
   cross a §D milestone?
8. **Backups** — PITR healthy, last backup succeeded.

**Rule:** a weekly review that finds nothing is a *good* review. If a number crosses a threshold,
the fix (bump tier / add index / add replica) happens that week — never let it ride to a crash.

---

## C. Thresholds — the numbers that trigger action

| Signal | Threshold | Action |
|---|---|---|
| CPU (sustained) | > 70% | Bump the compute tier |
| Memory | > 75% | Bump the tier |
| Connections | > 70% of pool | Raise pool size / add a read replica |
| Query p95 | > 2s | Index or rewrite that query |
| Disk used | > 70% | Grow disk (rate-limited to 4×/24h — plan ahead, don't wait for full) |
| Dead tuples | > live tuples on a table | Check autovacuum / manual VACUUM |
| Function error rate | > 1% | Investigate before it compounds |

---

## D. Scale milestones — when to do the next thing

- **~50 shops** — complete the §A one-time hardening pass.
- **~200 shops** — add a **read replica**; route board/read traffic to it, writes stay on primary.
- **~500 shops** — evaluate **partitioning** the biggest tables (`job`, `job_media`, `event`) by
  month; consider isolating any whale tenant.
- **~1,000+ shops** — sharding / dedicated instances for the largest tenants.

Everything above ~200 shops is a "nice problem to have" — at 100 shops paying real money, a bigger
DB tier or a replica costs a few hundred a month against tens of thousands in revenue. We can
always buy our way out of a compute problem — which is exactly the lever Xano never gave us.

---

## Changelog
- 2026-08-27 — created. The plan behind the "will Supabase crash like Xano?" conversation.
