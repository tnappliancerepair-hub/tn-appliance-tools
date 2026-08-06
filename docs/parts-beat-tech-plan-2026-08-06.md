# Beat-the-tech parts ordering — plan (2026-08-06)

**Teddy 2026-08-06:** "Once a job has been pre-diagnosed we need to order the part to beat
the tech to the customer's home. This would be the single biggest improvement in our system
and can be done — just needs to be built."

He's right: this moves the **first-visit-fix rate**, the north-star metric. The classic
money-loser is diagnose-trip → order part → return-trip. Pre-diagnosing remotely (video +
model # at intake, which we already capture) lets us order the part so it arrives *with* the
tech = one trip.

## The critical fork (why ~95% of jobs need a different play)

| | Who orders the part | The "beat the tech" play |
|---|---|---|
| **Cash / self-pay** | **We** order from Marcone, drop-ship to the customer's home. 100% ours. | Order at pre-diagnosis → part beats the tech. **This is what we automate first.** |
| **Warranty (AHS/ServicePower/SquareTrade, ~95%)** | The **warranty vendor** supplies the part (often ships to the shop). Ordering it ourselves **breaks the claim/reimbursement.** | We can't order it. The lever is (a) push the predicted part to the vendor *early* so their auto-order fires before the visit, and/or (b) compare the vendor's ETA (we already capture it via ahs-parts-watch / servicepower-parts-watch) against the scheduled visit and **alert** if it won't beat the tech. **Phase 2.** |

So Phase 1 is the cash path (clean, fully ours, plumbing proven). Phase 2 is warranty timing
visibility (no ordering — the vendor still ships).

## What already exists (we build orchestration, not plumbing)

- **`ant-brain-predict.js`** — predicts the part from history (numeric confidence). Advisory.
- **Human pre-diagnosis (Teddy Tool)** — writes `oem_part_number` / `verified_part_number`
  on the TDR and calls `flag-parts-to-order` → sets `jobs.parts_status='to_order'`. This is
  the actionable signal (a human chose the part).
- **`_lib/msupply.js`** — real Marcone connector: `lookupPart()` (live cost + stock + ETA),
  `placeOrder()` (real drop-ship PO). Proven (order #74992380).
- **`create-parts-order.js`** — writes a `parts_orders` row (table 47), ship-to-customer.
- **`parts-autoplace.js`** — the PLACER. Watches `parts_orders` rows (marcone + customer +
  `to_order`) and places them via `marcone-order`. SHADOW until `SELF_CHECKOUT_AUTOPLACE_LIVE`.
  **Assumes the row is already paid** (today it only exists because Stripe completed).
- **parts-watch feeds** — record what the warranty vendor ships (for Phase 2 timing).

## The gap (net-new)

1. **Bridge:** nothing turns a pre-diagnosed cash job into a `parts_orders` row.
2. **Timing brain:** nothing compares the Marcone ETA to the scheduled visit ("will it beat
   the tech?"). Today the flow is inverted — the part gates the schedule; we want the
   pre-diagnosis to drive *when to order*.
3. **Job-level dedup:** no single "already ordered this job's part?" guard across paths.

## Shipped now — `parts-beat-tech.js` (SHADOW-only)

Runs hourly (business hours). For every job flagged `parts_status='to_order'`:
- **Cash filter** — skips warranty (reports the count, so you see the cash-vs-warranty split
  of the opportunity).
- **Dedup** — skips a job that already has any `parts_orders` row.
- **Confident part** — only considers a human-confirmed `oem_part_number`/`verified_part_number`
  (never orders off the ML guess alone).
- **Live Marcone ETA** — `msupply.lookupPart()` → in-stock + transit days.
- **Timing verdict** — `beats_visit: true` (lands before the tech), `false` (will MISS —
  reschedule), or `null` (not-yet-scheduled → "order now, schedule around arrival").

It **creates nothing and buys nothing** — it logs the plan + a `parts_beat_tech_run` event.
This is the dry-run: run `?secret=<admin>` to see, on real jobs today, exactly which parts
we'd order and whether they'd beat the tech.

## The live path (waits on decisions below)

Once the decisions are locked, the live path is small and reuses the proven placer:
1. `parts-beat-tech` (live) **creates** the ship-to-customer `parts_orders` row from the
   pre-diagnosis (real part #, customer address, `supplier:'marcone'`).
2. The existing `parts-autoplace` cron **places** it from Marcone (drop-ship to the home).

Two independent flags = a safe graduation you can watch at each step:
- `PARTS_BEAT_TECH_LIVE=true` → rows get created (visible on the To-Order board) — still buys
  nothing. Verify the part #s, addresses, and timing look right.
- `SELF_CHECKOUT_AUTOPLACE_LIVE=true` → the parts actually ship.

## Decisions only Teddy can make (before the live flip)

1. **Cash approval gate — the big one.** For a cash job, do we order the part *before* the
   customer has paid/approved the repair? "Beat the tech" means ordering before the visit,
   which for cash means committing to a part cost before the customer commits to the repair.
   Options: (a) order only after the customer pays a deposit/approves (safest, but slower —
   may not beat the tech); (b) order on a confident pre-diagnosis for any *booked* cash job
   (they've committed to the trip/diagnostic fee); (c) office one-tap "order to beat the tech"
   per job. **Recommend (c) first** — office reviews the shadow list + taps to order — then
   graduate to (b) once accuracy holds. This is the same office-first → auto path we used for
   the ServicePower claims.
2. **Confidence bar.** Only a human-picked part (Teddy Tool `oem_part_number`)? Or also a
   high-confidence ML prediction (e.g. `ant_brain_prediction.confidence >= X%`)? **Recommend
   human-picked only** to start; add ML later once the brain's first-guess accuracy is proven.
3. **Miss handling.** When the ETA won't beat the visit (`beats_visit:false`) — order anyway
   + flag the office to reschedule the visit later, or hold? **Recommend order anyway + flag**
   (ordering early is never wrong; the office moves the day).
4. **Warranty Phase 2 scope.** Build the ETA-vs-visit *alert* off the parts-watch feeds
   (no ordering), and/or the early part-push to the vendor (needs the Frontdoor/ServicePower
   write API — Frontdoor dev starts 8/11)?

## Rollout

- **Now:** watch `parts-beat-tech?secret=<admin>` dry-runs for a few days. Confirm the cash
  candidates + parts + timing are right. (This also tells us the real cash-part volume — the
  size of the prize.)
- **Then:** lock the decisions above → wire the live create path (office one-tap first) →
  flip `PARTS_BEAT_TECH_LIVE` → verify rows on the To-Order board → flip
  `SELF_CHECKOUT_AUTOPLACE_LIVE` → parts start beating the tech.
- **Phase 2:** warranty timing alerts.

## The one-liner

*Pre-diagnose the job, order the part the moment we're confident, and have it waiting at the
door when the tech arrives — one trip, fixed.*
