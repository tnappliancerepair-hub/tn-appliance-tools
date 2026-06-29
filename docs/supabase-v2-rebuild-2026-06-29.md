# Supabase v2 — the clean rebuild (plan + Phase 0 shipped)

**Teddy's two instincts, 2026-06-29, both right:**
1. Build the new system on Supabase **in parallel, not live** — prove it bulletproof, then cut over.
2. The current system carries **a lot of clutter** from months of live firefighting — a Supabase rebuild is the chance to **leave the clutter behind** instead of copying it forward.

This doc is the governing plan. Phase 0 (a cloud v2 brain shadowing live traffic) is shipped.

---

## The clutter, in real numbers (the case for a clean rebuild)
Counted 2026-06-29:
- **460 XanoScript endpoints** (`api/**/*.xs`)
- **557 colony agents** — ~503 wired in the registry, but "wired" ≠ "fires." ~**204 are architect-built dormant** (61 `parts_lookup_*`, 40 `schedule_request_*`, 18 `recruiting_*`, 14 `performance_*`, etc.) with no real trigger or consumer. CLAUDE.md's own audit: *"Architect output is mostly theater."*
- **292 Netlify functions**
- **~1,015 SEO landers + symptom pages** (content — keep, separate from the app)

So the app's *logic* surface is ~460 XS + ~150 live agents + ~292 functions, and a big slice of that is dead, half-built, or superseded. **A copy-paste migration would carry the mess forward. A clean rebuild leaves it behind — but only if we keep the LESSONS.**

## The principle: keep the lessons, drop the dead weight
The months of firefighting weren't waste — they produced **hard-won rules**. The rebuild's spec IS those rules:
- The footgun catalog → becomes "things we never have to fight again" (we're off XS).
- The safety rules (no Teddy's-cell, warranty-never-pays, capacity caps, no-double-text, weekend-off, owner-is-last-resort) → become **tested code**, not tribal knowledge.
- What actually fires in production → that's the **port list**. What never fires → **left behind on purpose**, logged so we know we chose to drop it.

**Rule: nothing gets ported because it exists. It gets ported because it's load-bearing.**

## How we'll KNOW it's bulletproof (not hope — measure)
Same shadow pattern you already trust from the self-scheduling autopilot: v2 runs against **real live traffic**, decides **silently**, and we **compare its calls to reality**. We only cut a slice over when the agreement holds high long enough to trust. Then each cutover keeps a **rollback switch**.

---

## Phase 0 — SHIPPED (cloud v2 brain, zero live risk)
The first slice we're proving is the spine: **intake → schedule.**

- **`docs/v2-shadow-schema.sql`** — one Supabase table, `v2_shadow_decisions`. **Teddy: run this once in the Supabase SQL editor** (same project as the backup). That's the only manual step.
- **`netlify/functions/v2-shadow.js`** — a cloud-hosted v2 scheduling brain. Clean JS, **no Mac, no XanoScript.** A faithful clean-room port of `job_intake_complete.js computeOffer` (same gates, tech-by-zip, profile constraints, customer-availability honoring, route clustering). Every 3h it:
  - **Predicts** tech+day+time for each new live needs-scheduled job → writes its call to Supabase.
  - **Reconciles** prior predictions against what the live system actually did (tech match? day match?).
  - Reads live data from Xano during the overlap (that's expected in Phase 0). Writes ONLY to Supabase. Touches nothing live.
- **`netlify/functions/v2-scoreboard.js`** — the gauge. `?secret=<admin>` →
  `agreement.tech` (the headline), `agreement.day`, `no_fit_breakdown` (where the feed has holes), `?misses=1` to eyeball disagreements.
- **`netlify.toml`** — `v2-shadow` scheduled every 3h.
- **`_lib/supabase.js`** — added an `update()` (PATCH) helper for reconcile.

### Run it
- After the SQL table exists, it self-runs every 3h. Kick a first pass manually:
  `…/.netlify/functions/v2-shadow?secret=<admin>&dry=1` (dry = compute, write nothing) → then without `&dry=1`.
- Watch the gauge after a few days:
  `…/.netlify/functions/v2-scoreboard?secret=<admin>&days=14&misses=1`
- **Trust threshold:** `agreement.tech` holds high across cash + warranty + phone with ≥~30 reconciled jobs.

---

## The phased path (after Phase 0 proves out)
1. **Phase 0 (done):** shadow intake→schedule. Earn the agreement %.
2. **Phase 1:** stand up the Supabase **signal queue** (the un-meltable cloud queue) so the v2 worker doesn't depend on Xano's queue. *(This is also the thing that unlocks Railway-as-primary + multi-tenant scale.)*
3. **Phase 2:** cut the **intake→schedule** slice over to v2 live, keep the rollback switch. Everything else stays on Xano.
4. **Phase 3:** repeat slice-by-slice — TDR/completion, warranty, the SMS gate — each shadow-proven before it goes live, reversible after. Port only the load-bearing logic; leave the dormant 200+ agents behind.
5. **Phase 4:** Xano becomes the cold backup; Supabase-v2 is primary. Roles swap.

## What we are deliberately NOT doing
- Not a big-bang flip. Slice by slice, each one shadow-proven + reversible.
- Not porting the ~200 dormant architect agents. They get left behind (logged, not copied).
- Not ripping out Xano now. It runs the live shop until each slice is proven off it.
- Not touching the SEO landers / symptom pages — content, not app.
