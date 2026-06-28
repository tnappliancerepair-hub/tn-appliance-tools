# Flaw-Fix Game Plan (2026-06-28)

How we go about fixing the operational flaws surfaced in the 8,115-job analysis.
Principle: most pieces already exist — this is CONNECTING + turning on + verifying,
not building from scratch. One flaw at a time, all the way to "metric moved."

## The method (same 5 steps for every flaw)
1. **Measure it for real first.** The analysis %s are regex-soft. Before fixing, turn
   each flaw into a LIVE metric (a counter off real events) so we have a true baseline
   and can PROVE the fix worked. You can't fix what you can't measure.
2. **Inventory what exists.** Most fixes have a built piece sitting dark or half-wired.
3. **Wire the smallest gap** to close the loop.
4. **Shadow mode first** — it logs/text-to-Teddy what it WOULD do, acts on nobody, so we
   verify it's right before it touches a real customer. Every automation gets a kill switch.
5. **Flip live + watch the metric.** If the number moves, keep it; if not, re-diagnose.

> Do ONE flaw fully (measure → wire → shadow → live → watch) before the next. Resist
> turning on five half-tested automations at once (that's how the loop melted Xano before).

## The order (by impact — biggest leak first)

### 1. 🥇 Scheduling churn / no-show / cancel — 23% (DWARFS the rest, start here)
- **Exists:** availability captured at intake (LIVE); day-before reminder (LIVE); warranty
  auto-accept for SquareTrade (LIVE); self-scheduling autopilot (DESIGNED, dark);
  `ghost-confirm-slot.js` (built, called from nowhere); `intake-collector` (DISABLED after
  it spammed a customer 5×).
- **Gaps to wire:** (a) **confirm-before-roll** — a morning-of "still good for today?" text so
  we don't drive to "h/o said it's working / already fixed"; (b) re-arm `intake-collector`
  with a hard once-per-job guard; (c) wire `ghost-confirm-slot` into the board's "✓ accept"
  so accepting a slot confirms the customer before it locks; (d) speed-to-accept (auto-accept
  already live) so warranty doesn't send another company first.
- **Metric:** cancellations + no-shows per 100 scheduled jobs, week over week.

### 2. Chase overhead (5.6%) + Authorization friction (3.5%) — tackle together (both = office time)
- **Exists:** customer portal self-serve status (LIVE); ServicePower claims-sync (LIVE);
  parts-vendor Gmail poller (LIVE); ServicePower status push (LIVE in shadow).
- **Gaps:** (a) outbound **parts-status auto-chase** (we ask the vendor "where's my part?"
  automatically past ETA, parse the reply, update the job); (b) **surface $0 / over-limit /
  check-and-advise authorizations to the office instantly** so they don't sit; (c) flip
  `SERVICEPOWER_PUSH_LIVE=true` so status flows to the portal without manual entry.
- **API-gated piece:** Frontdoor status push waits on their API — do the API-independent
  parts of this now.
- **Metric:** inbound "where's my job/part?" contacts per 100 jobs; jobs stuck >X days in
  awaiting-parts / awaiting-autho.

### 3. Callback / "still not working" — 3.4% (trust + repeat trips)
- **Exists:** per-job pre-diagnosis to Teddy + tech (LIVE); ant-troubleshoot intelligence
  (fault codes + our history, LIVE).
- **Gaps:** (a) **first-visit-fix metric** (the north-star number — not tracked yet);
  (b) make sure pre-diagnosis → parts-on-truck before the first roll.
- **Metric:** first-visit-fix rate by appliance.

### 4. Second trip / wrong part (1.7%) + Parts back-order (0.7%)
- **Exists:** Marcone live lookup (LIVE); flat-rate menu auto-prices the part.
- **Gaps:** (a) **pre-order the part before the visit** off the pre-diagnosis;
  (b) multi-source (Marcone + Tribles + Reliable + Amazon-equiv) to dodge back-orders;
  (c) better part-number resolution (the confidence corpus) so we don't order the wrong one.
- **Metric:** % of jobs needing a 2nd trip for parts; back-order count.

### 5. Lost repair (buyout / cash-in-lieu / denied) — 1.1%
- **Gaps:** faster parts (so the customer doesn't take the buyout while waiting); capture the
  LTD/diagnosis billing cleanly when a buyout does happen so we still get paid for the trip.
- **Metric:** buyouts per 100 jobs; LTD billed on every buyout.

## Recommended first move
Start with **#1 scheduling churn**, and within it the **confirm-before-roll text** — it's the
single highest-leverage, lowest-risk wire (one morning-of message), it directly kills the
biggest waste ("drove out, customer says it's fine / not home"), and it's a clean place to
stand up the measure→shadow→live method we'll reuse on every other flaw.
