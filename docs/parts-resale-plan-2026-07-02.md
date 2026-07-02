# 📦 Parts Resale Plan — turning dead parts inventory into revenue (idea captured 2026-07-02)

Brainstormed with Teddy. This is a real line of business, not just a cleanup. Captured here so it isn't lost.

## ✅ UPDATE 2026-07-02 (PM) — SELLER ACCOUNT IS LIVE + HEALTHY (the unlock)
Teddy logged into the **Amazon Seller app** and it's fully functional: **"Your store is healthy" ✅**, Account Health green, and every FBA tool present — **Add a Product, Manage Inventory, Manage FBA Shipments, Manage FBA Removals, Manage Orders, Payments**. Product sales $0.00 / 0 open orders (dormant, not damaged); Payments shows -$0.63 (leftover fee, harmless — confirm plan: Individual vs $39.99/mo Professional).

**Why this matters:** the **FBA SELLING side needs NO developer/SP-API approval** — it's the Seller Central UI + app, and it's OPEN RIGHT NOW. The SP-API denial (and the buyer/Ordering drop-ship API) only block **automation**, which is a *later* layer. So the parts-resale plan's **Phase 1 (liquidate the storage unit via FBA) is unblocked today** — Danielle can start listing + building FBA shipments immediately.

**Two independent tracks, don't conflate:**
- **Track A — FBA selling (parts resale): OPEN NOW.** No approval needed. This is the money-maker + the storage-unit bleed fix.
- **Track B — SP-API automation + Amazon Business Ordering (drop-ship) API: still gated** on the seller-account reactivation → developer reapply → approval chain (watcher armed). Build when we want the automation layer.

**Immediate next step:** send Claude the storage-unit Google Sheet → brand-gating breakdown + ASIN-match worksheet (see "First concrete step" below). Then Danielle lists a first small batch to prove the pipe.

## The core problem it solves
- **Storage unit = $600+/month bleed.** Danielle has it all inventoried in a Google Sheet ("storage parts"). Parts are mostly **obscure, brand-new, that TN doesn't use** for its own jobs. Teddy wants to KILL the unit and stop the rent.
- It's trash-bound anyway → **zero downside.** If it sells, found money. If not, no loss. If a customer wants a refund, fine — give it back, it was trash.

## The decided channel: Amazon FBA (NOT eBay, NOT bulk-lot sale)
- **eBay = OUT** (Teddy's firm call): individual shipping hassle, scammers, and the "customer guesses wrong part → demands refund → leaves bad feedback" cycle. Done it for years, hates it.
- **Bulk-lot sale to another shop = OUT**: other shops have their own warehouses of unwanted parts; slim chance of a buyer.
- **FBA = the move.** Bulk-ship one pallet to Amazon → they warehouse, market, pick/pack/ship each order, handle customer service + returns. Unsold → Amazon disposes. Hits every eBay objection: no individual shipping, no scammer/refund drama (Amazon's problem), hands-off.

## Delegation model (Teddy's call)
- **Danielle = the operator.** She loads/lists the parts + builds FBA shipments. Paid a **percentage of sales** for the labor.
  - **Pay her on NET (post-Amazon-fee) payout, not gross** — Amazon takes ~15% referral + FBA fees; a % of sticker could pay her on parts TN nets $0 on. % of actual payout self-aligns to parts worth selling. Be generous — it's all found money.
  - Give her a **Seller Central USER login with limited permissions** (inventory/listings/FBA shipments) — NOT the master login, NO banking/payment/tax access. Same philosophy as the office one-login.

## Multi-source inventory → SKU-prefix tracking (solves "how do we track whose part sold")
Three inventory sources feeding one channel:
1. **`TN-`** = Danielle's storage-unit parts (obscure, brand-new).
2. **`JIM-`** = Jimmy also has a big personal parts stash he can't sell → consignment through TN's channel, split worked out with him.
3. **`SC-`** = **Second Chance parts** — used-but-TESTED-GOOD parts (mostly **control boards**) salvaged from the program Teddy started last year to save warranty companies money (tech thought a board was bad, replaced it, old board was actually good → saved it).

**Tracking = SKU prefixes.** Amazon reports every sale by SKU, so encode the owner in the SKU (`TN-`, `JIM-`, `SC-`, later `LEE-`/`AND-`). Month-end: sum each prefix's payout → pay each owner's split. **Zero custom software — Amazon's own reports do the accounting.** Scales to more techs.

**Money layers cleanly:** Danielle = operator % (labor, across all sources) · Jimmy = owner % (on `JIM-` sales) · TN = the rest.

## Second Chance parts = the most valuable pile — treat differently
Tested-good used control boards ($150–400 new) are high-value + high-demand. Two uses, internal first:
1. **REUSE INTERNALLY FIRST** (original purpose): put a tested-good salvaged board on a warranty/cash job instead of buying new → direct margin + the warranty-company-savings angle. **Ant Brain could flag "we have a tested-good SC board for this model on the shelf — use it"** before ordering from Marcone. Highest value, zero fees.
2. **Sell the surplus** via FBA (or own site) labeled honestly "Used – Very Good, tested working." Used condition = extra Amazon gating in some categories.

## THE BIG OBSTACLE: brand gating (learned the hard way)
- TN had an Amazon seller account before; **Frigidaire (Electrolux) blocked them from selling Frigidaire parts** ("brand gating" — manufacturers restrict who sells their branded parts). Common across appliance brands: Whirlpool, GE, Samsung, LG, Bosch, Frigidaire all tend to gate. Generic/aftermarket usually lists free.
- **TN's edge: Marcone (authorized OEM distributor) invoices.** To ungate a brand, Amazon wants invoices from an authorized distributor proving authentic sourcing. **TN buys from Marcone → those invoices are exactly what ungates brands.** Most part-flippers can't prove this; TN can. Re-test the Frigidaire block with proper invoices — gating policies change; the old block may be stale/account-specific.
- **Account caveat:** Amazon prohibits multiple seller accounts → likely REINSTATE the old account, not open new. Check the old account's status/baggage first.

## Channel map (final shape)
- **FBA** → brands we can sell free + brands ungated via Marcone invoices. Hands-off.
- **Own site (`tnapplianceexchange.net`, already has Stripe + Ant infra)** → fallback for brands Amazon blocks + the high-value used Second Chance boards. Zero gating, zero platform-feedback risk, zero referral fees — but WE fulfill/handle returns, so reserve for higher-value stuff worth the effort (control boards), not $8 obscure parts.
- **Trash/donate** → blocked + low-value + not worth own-site effort. Floor is still no-loss; donation may get a write-off (ask CPA).

## Future products line (separate, forward build — don't tangle with the cleanup)
Beyond liquidation, TN could sell **consumables/accessories** (hoses, cleaners, soaps, vent kits, coil cleaner, parts). Unfair advantages TN already has:
- **Point-of-repair upsell** — the add-on engine (`ant-addons.js`, waiver upsells) already sells fresh hoses/vent kits/coil cleaner at the door. Highest margin, zero CAC, captive audience.
- **Repair data tells us what to sell + when** — hard-water → HE detergent, clogged vent → vent kit, dirty coils → coil cleaner. Maintenance-reminder agents already exist → proactive, data-driven consumables no generic Amazon seller can replicate.
- **Private label** the soaps/cleaners under the TN / Ant brand (classic FBA play) once the seller account is live.

## First concrete step when we revisit
Send Claude the Google Sheet export → Claude produces:
1. **Brand breakdown** — which brands list free / need Marcone-invoice ungating / likely blocked.
2. **ASIN-match worksheet** for Danielle — `part# | ASIN | action (FBA / trash-direct)` so she isn't researching hundreds of obscure part numbers one at a time.

**Keep it SIMPLE to start** — SKU prefixes, Danielle operating, % splits, FBA. Prove it small before systematizing (surfacing owner payouts in the money hub, etc.).
