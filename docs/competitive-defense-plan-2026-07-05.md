# Competitive Defense Plan — "how a competitor would kill us, and the counter"
**2026-07-05 · the red-team → defense.** Companion to `docs/ant-operating-plan.md`.

The gut-punch from the red-team: **we spend our best hours on moonshots (the game,
SaaS, the consumer platform) while the core is RENTED (95% warranty = AHS owns our
demand) and FRAGILE (one founder, one Mac Mini, unverified shipped surface).** That's
exactly where a funded competitor attacks. This plan closes those holes, in order.

Key honest insight: **most of the machinery is already built.** The lever on almost
every line below is *turn it up + measure it + flip the guard on* — not build more.

---

## PILLAR 1 — OWN THE DEMAND (stop being AHS's gig worker)
**Vulnerability:** ~95% warranty. The warranty cos own our customers + demand and
can cut our rate or route elsewhere tomorrow. Self-pay is tiny; SEO is doorway-weak
(364 of 1,295 pages indexed — Google ignores most). We have no owned demand to fall
back on. **North-star metric: self-pay booked jobs/week and self-pay % of total.**

| Move | State | The lever |
|---|---|---|
| **Map-pack dominance** in home counties (Rutherford: Murfreesboro/Smyrna/La Vergne · Davidson: Antioch/Hermitage) | GBP already #1 organically | Clean GBP categories → *Appliance repair service only* (drop any "used/store"); list services; **post the truck + crew photos we just processed**; weekly GBP posts (generator built) |
| **Review velocity** — reviews drive map pack + LSA rank | satisfaction gate + review-request + reply-draft all BUILT | Turn it up: every completed self-pay + happy warranty job → review ask. Watch reviews/week climb |
| **Prune the doorway landers**, build a *smaller* set of strong city+appliance pages | 1,295 thin pages, ~364 indexed | Quality over volume — the index data proves more pages ≠ more traffic. Cut the dead weight, strengthen the ranking pages |
| **Google Ads** — dryer + fridge live, geo just widened, Call/Sitelink/image added | LIVE | Govern to **cost-per-booked-job**; verify the click→job conversion loop actually fires; scale winners |
| **LSA (Google Guaranteed)** — pay-per-lead, phone-first (Ant answers every call) | built, PAUSED | Flip on in the 3 tech-anchored pods once cost-per-lead is capped |
| **$50 Quick Check self-pay funnel** — the wedge off warranty | LIVE (intake IS the front door) | Point ad spend → intake → cash job; this is the escape hatch from vendor dependency |

**What Ant automates here:** GBP post drafts, review solicitation + reply drafts, ad
optimization + conversion matching, intake→quote→schedule, instant speed-to-lead reply.
Nearly all built — **the work is turning it up and measuring self-pay growth.**

---

## PILLAR 2 — GET A DATA PARTNER (turn the thing that beats our moat into our moat)
**Vulnerability:** our repair history (8 yrs / ~8k cards) is a rounding error next to
what Marcone/Reliable/AHS already hold — millions of dispatch→resolution→part records,
national failure rates, full supersession. A competitor could license a 1000× set and
make our part game a toy. **Metric: Ant Brain first-guess accuracy climbing (the game
already tracks it) + corpus size.**

| Move | State | The lever |
|---|---|---|
| **Pour our OWN archives into the predictor** — MeisterTask (8k cards) + HCP (~49k rows) already mined to Supabase | mined, **sitting unused** | Biggest immediate accuracy jump, ZERO external dependency. Embed into Ant Brain corpus so predictions aren't thin |
| **Reliable Parts** — 2nd OEM source (catches Samsung/superseded Marcone misses) | **specs + access already sent (Alex Quintans, Jun 23)** | Wire the connector now — the data's waiting |
| **Marcone / mSupply** — live cost/stock/ordering | LIVE | Chase **MarconeAI API** + a failure/supersession feed (Tim Wangelin) = national parts intelligence into Ant Brain |
| **AHS / Frontdoor Partner API** — status push + eventually dispatch/resolution data | **ticket open (Brian Bullock)** | Biggest single data lever; keep it moving |

**What Ant automates:** connector ingestion, corpus embedding (EMBED_TDR pipeline
exists), the predict→grade→remember loop (built + reality-graded now). **The move:
(1) pour the archives in now, (2) wire Reliable now, (3) chase MarconeAI + AHS feeds.**

---

## PILLAR 3 — DE-RISK (cut the bus factor + the fragility that becomes a trust event)
**Vulnerability:** one founder, one Mac Mini running the loop, Xano fragility, and a
pile of "shipped but not verified on a real device." An accumulated failure (bad blast,
wrong part shipped, warranty mis-filed at scale) becomes a reputation event — and trust
is the only thing we actually sell. **Metric: zero customer-facing incidents · ops
survives without Teddy for a week.**

| Move | State | The lever |
|---|---|---|
| **Flip the SMS safety guard to ENFORCE** (quiet-hours/caps/global-rate) | opt-out enforced; rest in SHADOW | Eyeball the shadow data, set `SMS_GUARD_ENFORCE=1`. Kills the 15k-text class of incident |
| **Smoke-test the money funnels before customer-facing changes** | ad hoc | A standing check on intake→pay→schedule, SMS send, warranty submit. Stop shipping the critical path blind |
| **Loop DR — get it off the single Mac** | LOOP_STORE=local cut Xano load; nightly Supabase backup exists | A backup runtime / cloud host so a Mac reboot doesn't stop ops |
| **Teddy-proof + Danielle-proof the office** | declutter + office autopilot partly built | Ops that survive a person leaving — the games (Claim Clock, part showdown) already push the right behaviors |
| **Observability that pages + self-heals** | health-check + watchdogs exist | Confirm a real failure alerts + auto-recovers |

**What Ant automates:** watchdogs, backups, health checks, the SMS guard, smoke tests —
mostly built. **The lever is flipping guards to enforce + a QA pass on the critical path.**

---

## SEQUENCE — what actually goes first

**Next ~2 weeks (cheap, high-protection + high-leverage):**
1. Flip `SMS_GUARD_ENFORCE=1` after eyeballing shadow data (stops the catastrophe class).
2. Smoke-test intake→pay→schedule + warranty-submit end to end.
3. **Wire Reliable Parts** (specs in hand) + **pour MeisterTask/HCP archives into Ant Brain** (huge accuracy jump, no external wait).
4. Verify the Google Ads conversion loop fires; turn **LSA** on in the 3 pods.

**30–60 days (own the demand):**
5. GBP cleanup + the new truck/crew photos + weekly posts + review velocity.
6. Prune doorway landers → strengthen the real city pages.
7. Scale ad winners on cost-per-booked-job; grow **self-pay %** as the north star.

**60–90 days (deepen moat + de-risk):**
8. MarconeAI + AHS data feeds; loop off the single Mac / real DR; office Teddy/Danielle-proofing.

## DO NOT (until the core is unkillable)
Don't pour the best hours into the SaaS product or the consumer platform yet. Rented
demand + fragile ops is where a competitor wins — make the local core unkillable first,
then the moonshots launch from strength instead of exposure.

---
*Changelog: 2026-07-05 created from the "how would a competitor beat us" red-team.*
