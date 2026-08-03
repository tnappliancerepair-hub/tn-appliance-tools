# Warranty Jobs, Fully Automated Inside Ant — Possibility (2026-08-03)

*Teddy asked: what's the possibility of expanding the warranty-job automations INTO
our app — so the office and techs run everything from Ant and the vendor portals go
invisible. This is the honest read: possibility is HIGH, and it's arguably the most
valuable thing we can build, because it's also the L2 SaaS product.*

## The vision
A warranty job flows **dispatch → paid entirely inside Ant, hands-off**, with the
vendor portals (ServicePower, Frontdoor/AHS, NSA) reduced to systems we **sync to,
never touch by hand.** The office watches one board; the tech fills one TDR; and
everything between — accept, schedule, intake, pre-diagnose, order parts, push status,
file the claim, reconcile payment, track returns, pay the tech — runs automatically
and is **visible + controllable in the app.** Humans touch only the exceptions.

## Why possibility is HIGH: ~80% of the machinery already exists
This is not a from-scratch build. It's **surfacing + closing a few gaps + flipping
shadow flags.** The 12-stage warranty lifecycle, today:

| # | Stage | Automated? | In-app surface |
|---|---|---|---|
| 1 | Dispatch intake (vendor email/API → job) | ✅ live (pollers) | office-board |
| 2 | Accept dispatch | ✅ live (`servicepower-auto-accept`) | — |
| 3 | Schedule (tech + day) | 🟡 partial (cluster-suggest / auto-assign) | new-scheduling, office-board |
| 4 | Customer intake (video / model# / availability) | ✅ mostly (auto-texted link, OCR) | job tile |
| 5 | Pre-diagnosis (predict the part) | ✅ live (`ant-brain-sweep`, Ant's Guess) | tech-job |
| 6 | Parts (order before the visit) | 🟡 partial (watchers, drop-ship) | warranty-parts |
| 7 | Tech visit + TDR (**the TDR = the claim**) | 🟡 semi-manual | tech-job TDR card |
| 8 | Status push to vendor portal | 🟡 built, SHADOW | — |
| 9 | Claim submit (TDR → claim) | 🟡 built, SHADOW (running hourly) | — |
| 10 | Reconcile status + payment | ✅ live (`claims-sync`) | warranty-review, dashboard |
| 11 | Parts returns (RMA / chargeback shield) | ✅ live (`rma-watch`) | warranty-review worklist |
| 12 | Payment → tech payout | 🟡 partial (`payout-ready-notify`) | money / payroll |

**Read the colors:** the pipeline is already ✅ or 🟡 at every stage. Nothing is 🔴
"doesn't exist" except a couple vendor-specific pieces. The expansion is finishing the
🟡s and pulling them onto ONE surface — not inventing the pipeline.

## The four expansion moves

### 1. The in-app Warranty Command Center (the surfacing layer) ⭐
Today the automation is spread across ~20 backend functions + 4 half-built pages
(warranty-review, warranty-claims, warranty-submission-dashboard). Pull it into **ONE
board** that shows every warranty job's position dispatch→paid, with each stage's
status live, and **acts only on exceptions.** This is the "make the board the source of
truth" work (already proven on the office-board) applied to warranty. It's what makes
the automation *legible + controllable*, and it's the screen a SaaS customer would buy.

### 2. Close the three semi-manual stages
- **TDR autofill (stage 7)** — the tech's #1 friction. Pre-diagnosis already predicts the
  part; auto-seed the TDR from it + voice + tap-fields so "finishing the TDR" is a
  confirm, not a compose. This ALSO improves claim quality (the TDR *is* the claim).
- **Auto-route scheduling (stage 3)** — dispatch → area tech + day, hands-off (the
  documented SquareTrade-auto-schedule goal), human only on an exception.
- **Money loop (stage 12)** — warranty EFT lands → auto-split across jobs → mark paid →
  release the tech's cut. Closes the last manual finance step.

### 3. Flip the shadow stages live (status-push, claim-submit)
The whole Phase-A of `warranty-claim-automation-scope-2026-08-03.md`: decision-diff
validate the shadow claims, then flip `SERVICEPOWER_PUSH_LIVE` (status — no money) →
`SP_CLAIM_AUTOSUBMIT_LIVE` (claims — money), Danielle as hot rollback.

### 4. Exception-only human queue
When 1–3 are done, the office's entire warranty job becomes a **red-flag queue**: a
rejected claim, a missing tech, an incomplete TDR blocking a claim, a parts-return
overdue, a dispute. Everything else runs silent. That's the end state — the office
*supervises* warranty instead of *doing* it.

## The strategic payoff — this is the L2 product, not just an internal tool
Three reasons this is the highest-leverage warranty work:
1. **Biggest labor kill.** Warranty is 95% of jobs; automating it end-to-end removes most
   of the office's day (the Danielle-replacement goal), and lets the board finally retire
   MeisterTask + the vendor portals as daily tools.
2. **It's the SaaS product (operating plan L2).** Every appliance shop **drowns in warranty
   paperwork** — multiple vendor portals, claim codes, payment chasing, parts returns. An
   app that runs the whole warranty lifecycle hands-off is *exactly* what a shop pays for.
   TN's own ops = the proving ground; this in-app warranty engine = the thing we sell.
3. **It's a moat.** The claim-code mapping, the TDR→claim translation per vendor, the
   multi-vendor sync + reconciliation — that's accumulated know-how a ChatGPT wrapper
   can't clone. The deeper it goes, the harder to copy.

## What makes it non-trivial (the honest constraints)
- **Vendor-facing + real money** — a wrong claim/status = lost payment + partner-relationship
  risk. Every live flip follows the shadow → decision-diff → one-actor → hot-rollback
  discipline (same as the loop migration). Non-negotiable.
- **External authorizations** — Frontdoor API (Brian must authorize our key), NSA portal
  creds. Gate the AHS/Frontdoor half; nothing we build unblocks them.
- **Multi-vendor complexity** — each vendor's claim model differs (ServiceClaims API vs
  AHS's model vs SquareTrade's web wizard). The abstraction (plain TDR → per-vendor claim)
  is the hard, valuable part — and it's already the design.
- **TDR completeness is the dependency** — the claim is only as good as the TDR; stage 2
  (TDR autofill) is load-bearing for the whole thing.

## The recommendation
Possibility is high and the ROI is the best on the board. Sequence:
1. **Build the in-app Warranty Command Center** (surfacing move #1) — makes the existing
   automation visible + controllable, and is the L2 product seed. *(My no-blocker work.)*
2. **Wire the claims decision-diff + flip-readiness scorecard** (from the scope doc) so we
   can watch shadow claims match reality.
3. **Close TDR autofill** (move #2) — unblocks claim quality + kills the tech's friction.
4. **Flip status-push, then claim-submit** as they validate (move #3).
5. **Frontdoor/NSA + the money loop** in parallel as authorizations clear.

*The pipeline already exists end-to-end in shadow/partial. The opportunity is to finish
it, surface it as one in-app engine, and take it live the safe way — which simultaneously
runs TN hands-off AND builds the thing other shops will buy.*
