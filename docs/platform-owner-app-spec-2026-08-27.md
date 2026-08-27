# Ant Platform — KPI + Money + Roles spec (2026-08-27)

Design settled with Teddy across the 2026-08-27 session, driven by prospect **TK Cousins
(The Appliance Guy)** + TN's own pain. The through-line: **write once → the numbers fall
out.** Capture the work once (job + invoice), and KPIs, pay, and the books all derive from
the same ledger — so a tech's app can never disagree with his check, because they read the
same row. This is the fix for "our own tracking has not been accurate" (techs' app said one
thing, they got another) and for TK's Workiz+QuickBooks mess (two systems fighting).

## Three lenses, one ledger
Same data, filtered by what each person needs to DO with it.

| Role | Sees | Never sees |
|---|---|---|
| **Tech** | own pay (earned → collected → paid), own upsell earnings, own performance KPIs, the leaderboard | shop revenue, margin, owner take-home, peers' pay |
| **CSR** (customer service rep) | invoicing + payments — what's billed, collected, still owed by customers/vendors; splits the warranty batch back to each job | owner take-home / profit |
| **Owner** | everything — the money flow AND the profit (revenue − costs = take-home) + all KPIs + per-tech | — |

## The money model (why the number stops being wrong)
The old inaccuracy = the app showed **earned** (on completion) while payroll paid
**collected** (on remittance), and warranty vendors pay late, in batches, often *less* than
billed. Never the same number. Fix = show the money's real STATE, never one guess:
- **Earned (pending):** job done, this is your cut *if it pays in full.*
- **Collected & owed to you:** money actually landed → this is your next check.
- **Paid:** already on a check.
A warranty job sits at "earned $150 · collected $0 · waiting on AHS," then updates to
"collected $105" when the vendor remits, and the tech's cut recomputes on the REAL amount —
visible the whole way, so a smaller check is never a surprise.

Rules:
- **Financial source of truth = the job-tile invoice the office writes as they submit it**
  (Teddy 2026-08-27). Every money number — billed, collected, owed-to-tech, take-home — derives
  from that single entry the office/CSR makes on the job tile. NOT from scraped claim-remittance
  snapshots or a separate accounting tool. One entry, on the tile, once. (Claim/EFT status may be
  mirrored as informational context for the CSR's claim tracking, but it is NOT the money number.)
- **Pay-on-collection** ("when I get paid, they get paid") — the default; owner-configurable.
- **Commission is an OWNER setting per shop** (% of labor / flat per repair / per-tech) — not
  hardcoded. Platform computes pay from the owner's rule + the invoice.
- **Upsells belong to the tech** — shown on his own pay + a "Top Upseller" leaderboard crown.
  The shop's cut of the upsell is owner-only, never in the tech's face.
- **Platform TRACKS money, never HOLDS/processes it.** Shops keep their own collection method
  (Stripe/Square/cash). QuickBooks = a clean **export** for the accountant, NOT the source of
  truth (making it the truth is what burned TK).
- **The accuracy hinge = the CSR splitting each warranty remittance back to its job.** Make
  that fast + hard to get wrong, and pay is accurate to the penny. Add a **reconciliation
  check** that flags any gap between "what the app said" and "what got paid" each period — so
  the OWNER catches drift, not a tech.

## Owner-only per-tech WATCH metrics (rates, NOT leaderboard) — Teddy 2026-08-27
The owner needs to spot outliers; these are never celebrated or ranked. Always expressed as a
**percentage** so techs with different volumes compare fairly (4 condemned of 200 stops ≠ 3 of 80).
| Watch metric | Definition | Data |
|---|---|---|
| **Condemn rate** | recommend-replacement (`no_fix_possible`) ÷ that tech's jobs, % | ✅ now (per-tech mapped). Live sample: John 3/139 = 2.2%, others 0%. |
| **Reassign rate** | jobs the tech reassigned/handed off ÷ jobs completed, % | needs reassignment-event pull (reassign_job / tech-request-reassignment) |
These live in the owner board's **per-tech table** alongside first-stop %, next to (not on) the
leaderboard. A guy drifting high on either is obvious to the owner; nobody competes on them.

## KPIs (TK's "front and center")
| KPI | Definition | Accurate now? |
|---|---|---|
| **First-stop completion %** | fixed on visit 1, no return trip; a job that went awaiting-parts → return is NOT first-stop. **Warranty parts backorder is a "parts" miss, not the tech's** | needs TDR/return-trip data mirrored |
| **Recommend Replacement** (= condemned) | disposition `no_fix_possible`. An OUTCOME/mix number, not a tech grade; quiet outlier-watch for owner only | ✅ now (`xano_status`) |
| **Callbacks** | return to the same machine within N days (default 30) because the fix didn't hold — the real quality signal | repeat-customer proxy now; true same-unit needs unit linkage |
| **Pipeline** | scheduled / awaiting-parts / in-progress / completed | ✅ now |
| **Warranty vs cash** | mix; parts-awaiting aging | ✅ now (~97% warranty at TN) |

## Leaderboard (tech side) — built to LIFT, not crush — LOCKED 2026-08-27 (rev: 7 crowns)
Seven crowns so everyone can win one (validated against field-service research — FTFR + 30-day
callback are the industry's #1/#2 KPIs):
| Crown | Metric | Data |
|---|---|---|
| 🥇 First-Stop King | first-time fix rate (fixed visit 1, no return) | TDR/return-trip ✅ |
| 💚 Cleanest Work | lowest callback rate (same machine ≤30d) | TDR + unit linkage |
| 💵 Top Upseller | upsell/add-on revenue $ | add-on tracking |
| 🎯 Best Attach Rate | % of jobs with an add-on (fair to low-volume) | add-on tracking |
| ⭐ Customer Favorite | review rating / CSAT | review capture |
| ⚡ Workhorse | jobs completed | mirrored ✅ (per-tech mapped) |
| 🧠 Sharpest Diagnosis | first-guess part accuracy (beat Ant) | brain predict/grade |
Plus a blended **Tech of the Month** (real reward).

**Recommend-replacement is NOT on the leaderboard** (Teddy 2026-08-27): it's not something to
celebrate or reward — rewarding it would push techs to condemn machines they could fix. It lives
on the **OWNER board as a per-tech stat** so a tech with too many is obvious to the owner. (This
retires the earlier "Straight Shooter" crown idea entirely.)

Fairness guards: **min ~10 jobs/month to be ranked**; **first-stop counts a warranty-part
backorder as a parts miss, not the tech's**; **attach-rate lets a lower-volume, high-quality tech
win.** Leaderboard = PERFORMANCE, never each other's pay. Research: FTFR industry avg ~80%;
failed first visit → 2.7 visits, +13 days.

## Owner app — v1 scope + roadmap
**v1 (build now):** owner scoreboard, RLS-scoped to the company, from real data —
KPI tiles that are accurate today (recommend-replacement, callbacks proxy, pipeline,
warranty vs cash) + the money section STRUCTURE (earned/collected/paid) reading real
invoices, with honest empty/partial states where the ledger isn't populated yet. **No
fabricated numbers** — that's the whole point.
**Next:** map Xano tech → platform technician (unlocks per-tech + leaderboard); mirror
TDR/completion data (unlocks accurate first-stop + full recommend-replacement); CSR
invoicing + warranty-batch split; commission settings UI; reconciliation check; tech
scorecard; then the leaderboard.

## Standing constraints
Platform never holds funds. Owner-configured commission. Techs never see shop economics.
Accurate-or-absent (never a fake number). One ledger feeds all three lenses.
