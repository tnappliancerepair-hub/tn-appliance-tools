# 💰 Money & Numbers System — the plan (talk-through captured 2026-06-27)

**Status: PLAN ONLY. Nothing built from this yet** (Teddy: "I don't want to make any changes yet — talk it through first"). This is the design exactly as Teddy decided it across a long brainstorm. Build from this on his go, in the phase order at the bottom.

Replaces: **Google Sheets** (where numbers were stored by hand) and **MeisterTask** (the old "source of truth" job tickets). Both retire because their numbers become things Ant *computes*, not things a human *maintains*.

---

## 1. The one principle (everything hangs off this)
**The job drawer is the single source of truth. Every money fact is entered ONCE, where it's born, at the moment it's known — and payroll, tax, P&L, the tech's pay, and the 1099s are all just *lenses* on those same drawer entries.** Nothing is re-typed anywhere. The design test for any field: *is this a new fact, or can Ant derive it from something already entered?* If derived, nobody types it.

## 2. Three access tiers (same numbers, three views)
- **Tech** → sees **only his own pay** (his slice, nothing else).
- **Office / Danielle** → the **job drawers + operations** (billed, collected, scheduled, parts). Runs the business day-to-day. **Does NOT see the owner P&L / take-home.**
- **Owner (Teddy)** → **everything + the P&L**, PIN-gated. For his eyes and his tax people only.

## 3. The drawer's financial section = the money cockpit
One spot on every job, four little zones:
1. **The bill** — labor, each part (cost → sell → margin), add-ons, tax.
2. **Money in** — amount collected, **method** (cash / check / card / Apple Pay / warranty EFT), date; pending-vs-paid state.
3. **Tech pay** — the tech's cut, shown **pending → ready** (see §4).
4. **Parts responsibility** — expected/received checklist + return status (see §6).

That section *is* the ledger entry. Every other money view is a filter on it.

## 4. Money model — PAY-ON-COLLECTION
Teddy's rule, verbatim: **"When I get paid, they get paid."** The shop never fronts money it doesn't have.
- A job's money is a little story over time: **billed (earned) → paid (collected) → tech released.**
- **Tech sees two buckets:** **Earned/pending** (work done, report in, waiting on the warranty EFT or collection) and **Ready** (job got paid → releases next payday, 3rd & 18th). Makes the delay transparently the *warranty company*, not the shop — kills payday-surprise stress.
- **Tech's cut rides COLLECTED dollars.** If a claim is knocked from $150→$105, the tech's % is on the $105. Nobody has to "eat" a shortfall — you only ever split real, collected money.
- **The report incentive (huge side effect):** the drawer only has a number when the report's turned in → **no report = $0 on payday.** Filing the report becomes the tech's own financial interest. This is the cure for the chronic empty-TDR problem — incentive, not nagging.
- Same number, three audiences: office bills it, tech sees his slice, owner sees the P&L.

## 5. Parts pricing — the real shop formula (from Danielle, the source of truth)
**Tiered:**
- **Part $30 or over → cost ÷ 0.75** (this is a **25% margin** = 33% markup).
- **Part under $30 → cost + $10** (flat floor so cheap parts are worth a tech's time).
- The tiers meet cleanly at $30 ($30 ÷ .75 = $40 = $30 + $10).

Notes:
- It's a **margin** method (÷.75), not a markup — label it honestly on the P&L so 25% doesn't get recorded as something it isn't.
- **Auto-fills** on ordered/drop-ship parts (cost known → sell computed); **manual override** always available (enter cost paid + sell price). Same rule both paths.
- **Warranty-supplied parts = NO markup** (reimbursed by the warranty co). The formula only fires on parts the customer actually buys (out-of-pocket / self-pay). A warranty job shows no phantom parts margin.
- Techs earn **nothing** on parts margin — it's pure shop margin.
- **OPEN:** rounding on the ÷.75 result ($133.33 → leave exact / $133 / no-9s $135?). Decide at build.

## 6. Parts responsibility — biggest cost AND biggest profit lever
Every part on a job is a tracked line with a **source** and a **status**, sitting in the drawer.

**Auto-populated** with every supplied part and where it came from — **us (we ordered), SquareTrade, AHS, NSA, anybody else.** Reality: auto where we have a feed (our parts orders ✅; SquareTrade return-label emails ✅), **manual "add a supplied part"** for sources without a feed yet (AHS/NSA/FrontDoor — fill in as feeds get wired). Structure holds day one even while auto-population catches up.

**The checklist the tech runs per part:**
1. **In hand?** (catches "supplier said 4, only 3 arrived" before the visit)
2. **Installed / not used**
3. **Old part removed → keep for return?** — and **"customer says there's no old part"** is a tap, timestamped (the Miss Jones shield)
4. **Shipped back** (tracking) → **confirmed received**

**Expected vs. received vs. discrepancy = the radar:**
- **Expected** = what the supplier says they sent. **Received** = what's actually there (tech + customer confirm).
- **Mismatch fires an alert** → in v1, **the tech calls Teddy/Danielle right then** to resolve live, AND **taps "⚠️ parts discrepancy"** which stamps the job (time, tech, what was said). *Call = resolution; tap = the record.* A verbal call with no log loses the same as a memory.
- **Fault follows custody:** the tech is **only responsible for parts he confirmed received** and then mishandled (case 1). Never-arrived / customer-didn't-have-it / shipped-and-lost = documented the day-of, becomes the office's or supplier's problem.

**Back-charge policy:** under pay-on-collection, an unreturned part that kills a claim *already* costs the tech (job never gets "paid" → no cut). So back-charge is the rare edge case (core charge but claim still paid). When it IS the tech's fault and we do charge: **cost-only, not punitive** (techs make no parts margin) — possibly a "first one's a warning." **OPEN:** keep case-by-case (Teddy's judgment) vs. a firm rule. Lean: keep flexible, just make it **visible** (per-tech parts-owed-back aging from the RMA tracker) so it's an informed call, never a guess.

**Profit side (Teddy: parts have the biggest upside too):**
- **Margin** on self-pay parts (the ÷.75 rule).
- **Parts-ahead = first-visit-fix** — if the ticket knows the part before the tech rolls, it's one trip not two. Second trips are the single biggest profit leak.
- **The compounding corpus** — every job's model→failure→part trains the next diagnosis (see §11).

## 7. Warranty EFT reconciliation (how income closes the loop)
EFTs **land in email, pay MANY jobs at once**, usually with per-job labor + parts breakdown. All traceable back to the drawers (drawer holds *billed*; EFT says *paid*; matched by claim/dispatch #).
- **One EFT → split across its jobs → stamp each drawer paid** (labor $ + parts $, EFT #, date) → cascade fires: **income on the P&L + tech cut releases (pending→ready) + parts reimbursement recorded.** No hand-splitting a lump sum.
- **The reconcile (gold):** (1) **sum of allocations must equal the EFT total** — if not, it flags for a human (nothing silently lost); (2) **per-job paid-vs-billed surfaces shortfalls/disputes automatically** (your dispute radar — stop finding out you were shorted by eyeballing a sheet).
- **Sources:** SquareTrade (your main client) — **already pulled via the claims API** (paid amount + EFT#, validated to the penny), *more* reliable than email parsing. AHS/NSA/others — parse remittance email (formats vary = the fiddly part) with **manual "log this EFT"** as the always-there fallback. Loop closes for the bulk today, fills in source by source.

## 8. Tech pay dashboard (modify the existing Pay page — don't build a new one)
Grow the existing **Pay page** (`tech-payouts.html`) into the tech's own dashboard:
- Period toggle: **This week · This pay period · This month · This year** + the big total for the range.
- Itemized jobs behind each total (not a mystery number).
- **Pending vs. paid** split (honest to pay-on-collection).
- **Year = running YTD = the 1099 number** at tax time, to the penny, no reconciliation.
- It **replaces the Google Sheet receipt** — "Mark Paid" generates the tech's statement line; could auto-text "you've been paid $X — see your statement."
- **Accurate by construction** — reads the drawer (same numbers the office bills and that hit his check), so the three can't disagree. That's the trust.

**1099 vs W-2:** YTD paid total = the 1099-NEC number, ready now. **W-2 is a separate payroll/tax step** (withholding, filing, workers' comp — the ~8% employer load Teddy can't carry yet; really ~10%+ with FUTA/SUTA/comp). **Build the earnings data W-2-ready now** (same feed a payroll provider consumes) and flip to W-2 when cash flow can carry it. Don't let the W-2 cost hold up the dashboard — the dashboard helps *get* to where W-2 is affordable.

## 9. Owner P&L (owner-only)
- **All money in − all expenses = what's left over.** PIN-gated, owner + tax people only — never in tech or office views.
- **Auto-rolls up** from every drawer (money in, parts cost, tech pay, tax) + the expense side. Nobody maintains it; Teddy opens it and sees the truth.
- The piece that makes it *honest* = the expense side (§10).

## 10. Non-job expenses (the other side of the P&L)
Gas, truck, tools, ads, rent, software, the card. Without these the P&L *overstates* what's left.
- **Digits** already pulls the card/bill side into the owner **Books** tab — much of this is handled.
- Likely need a dead-simple **"log an expense"** for cash items not on a card.
- Feeds the owner P&L only.

## 11. Durability / backup — the fall-back when Sheets are gone
Teddy's real worry: Sheets was the safety net; if jobs get erased, what's the fall-back?
- **Nothing hard-deletes today** — removals are **soft-deletes** (canceled, hidden, recoverable). First net.
- **The real fix: automated nightly export OFF Xano to storage Teddy owns** (S3 / Google Drive) as CSV/JSON. **Source of truth ≠ backup — always keep an independent copy.**
- **Optional: keep auto-writing a Google Sheet mirror** — Teddy keeps the familiar fall-back, just stops *typing* into it; the system writes it nightly.
- **MUST be off the Mac** — the Mac Mini is itself a single point of failure (a backup script exists but currently lands on the Mac; move it to cloud Teddy owns).
- **Do this BEFORE fully retiring Sheets.** It's the safety net that makes letting go safe. **Highest-priority build item.**

## 12. History rescue + the pre-diagnosis brain (MeisterTask = the goldmine)
**MeisterTask** (not HCP) holds the gold — notes, parts, financials per job. HCP is just "customer + a note." Boards: **TN Jobs (created 2018 ≈ 7 yrs!), NOLA Jobs, Florida Jobs (2021, old), Scheduling.**

**⏰ STEP ZERO — DONE 2026-06-27:** Teddy exported all boards, **JSON (full backup) + CSV** (with **Comments ON + Include-archived ON** — archived = the completed jobs = bulk of the value). Exports process async → **download links arrive by email and EXPIRE (24–72h)** → grab promptly → one dated folder → **copy to Google Drive (off the Mac)** → open one JSON to confirm real content. JSON = the complete copy (captures everything regardless of CSV toggles); CSV = the readable copy.
> Confirmed live in the export account: things ARE being deleted (notifications showed repeated "deleted"), and it's on the free tier — so grabbing this now was genuinely time-sensitive. If export were ever greyed out, paying ONE month to unlock a full export of 7 years is the cheapest insurance there is.

**How the import → vector brain works (plain):**
1. **Export** the cards as text (notes, parts, symptoms, fixes).
2. **Clean** each into a tidy record (customer, appliance, model, symptom, cause, part, resolution).
3. **Embed** each (text-embedding-3-small, already wired) → a meaning-fingerprint stored in the embeddings table.
4. **Use** — a new job's symptom is fingerprinted → Ant pulls the closest past jobs ("seen this LG fridge no-cool 14×, 11 were the relay, here's the part"). Pre-diagnosis gets sharp off years of *your own* fixes.

**Rules:**
- Free-text notes are *ideal* embedding fuel — messy is fine.
- **Import history into an ARCHIVE + the VECTOR STORE, NOT the live operational tables** (keeps the board/scheduling lean and fast).
- **Keep media in S3/Cloudflare, not Xano** (text is light; media is the storage risk).
- **Don't retro-load old financials into the new P&L** — start the books fresh going forward; old financials = reference/backup only.
- The export also doubles as a permanent **backup of the old system**.

## 13. What already exists (build ON this, don't rebuild)
Invoice worksheet (drawer) + `record_job_invoice` · `money.html` (Payroll / Sales Tax / P&L / Books) · `tech-payouts.html` + `tech-earnings.js` · `payroll-rollup.js` · `record-payout.js` · `parts_orders` ledger (cost/sold/margin) · add-ons system (record-addon/save-extra/addons-for-job — already does cost+30%-style pricing, paid/unpaid, tech credit) · **Digits** (Books / expense side) · `servicepower-claims-sync.js` (claim paid + EFT#, validated) · `payout-ready-notify.js` (EFT→ready-to-release) · `xano-backup.js` (snapshot — needs to go off-machine) · soft-delete via `office_remove_job`.

---

## Suggested build order (when Teddy says go)
- **Phase 0 — Safety net first.** Off-Xano nightly backup to cloud Teddy owns (+ optional Sheet mirror). Secure the MeisterTask exports in Drive. *(Makes retiring Sheets safe — do before anything else.)*
- **Phase 1 — Complete the drawer financial section.** Payment-collected capture (amount / method / date, pending↔paid) + parts-pricing auto-formula (÷.75 / +$10) with manual override.
- **Phase 2 — Pay-on-collection + tech dashboard.** Wire pending→ready off collection; grow the Pay page into week/month/year/YTD with itemized jobs.
- **Phase 3 — Warranty EFT allocation + reconcile.** SquareTrade via claims API first; email-parse + manual log for the rest; the two reconcile checks.
- **Phase 4 — Parts responsibility.** Expected/received checklist, auto-populate from feeds + manual add, discrepancy call-and-tap.
- **Phase 5 — Owner P&L complete.** Fold in non-job expenses (Digits + simple cash-expense log); 1099 export.
- **Phase 6 — History → brain.** Clean MeisterTask exports → archive + embed into the vector store for pre-diagnosis.

## Open decisions to confirm before/at build
1. Rounding on the ÷.75 parts price (exact / whole dollar / no-9s).
2. Exact payment methods to track (cash, check, card/Apple Pay, Zelle, Venmo, warranty EFT, …).
3. Back-charge: case-by-case judgment vs. a firm rule.
4. The one headline number on the tech dashboard (made-this-year / ready-next-payday / this-week).
5. Migrate any historical financials, or start the books strictly fresh (lean: fresh; keep old as reference).
6. Keep a live Google Sheet auto-mirror as the familiar fall-back, or cloud CSV/JSON only.
