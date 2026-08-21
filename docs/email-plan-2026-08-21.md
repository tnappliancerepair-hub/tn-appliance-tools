# Teddy's Email Plan (living doc — developed over several days)

**Pace (Teddy 2026-08-21):** "This has to be built over the next few days." Design
first, build second. Teddy drives tempo. Capture each decision here as it lands — this
doc is the spine across sessions, don't let it drift.

## The problem (Teddy's words)
"I get so many emails that I just kind of ignore them and then fall behind on handling
them."

## The reframe
It's **not a volume problem — it's a signal-vs-noise problem.** The 3-4 emails that need
*Teddy* are buried under a pile that's either already handled by Ant or pure noise. From
the inboxes (tnappliancerepair@ · tnappliance@ · inbox-3 · inbox-4), most of what lands is:
- **Already handled by Ant** — ServicePower/AHS/Frontdoor dispatches auto-flow into jobs,
  Marcone/Reliable invoices, parts updates. Danielle/Sofia/automation's lane, not Teddy's.
- **Noise** — Reliable Parts marketing, GE deals, Amazon shopping confirmations, badge emails.
- **Needs Teddy** — a handful: API/vendor decisions (Amazon Ordering API, ERP, SmartHQ subs),
  partnerships, the occasional real fire.

Goal: **surface the ~5 that need him, route the rest, kill the noise** — the same
"only show me decisions" model Teddy runs everything else on.

## The plan — 4 tiers (draft)
1. **Kill the noise** — Gmail filters (set once): marketing/promos + Amazon shopping +
   badge emails → auto-archive to a label. Out of the primary view.
2. **Route by owner** — warranty/scheduling → Danielle · customer → Sofia/Ann ·
   receipts/financial → Alyse/bookkeeping. Filters + labels, automatic.
3. **Teddy's decision queue (the unlock)** — an Ant **"Teddy's Desk" daily digest.** Each
   morning Ant scans all inboxes and sends ONE message with:
   - 🔴 Needs your call (3-5 items, one line + why)
   - 🟡 FYI / handled (routed — so he's aware)
   - 🗑️ Auto-filed (count only)
   Same machinery as the API watchers + phone scorecard (proven pattern).
4. **The ritual** — 10 min/day on the 🔴 list; 20-min Monday sweep for anything that slipped.

## Open decisions to work through (the next few days)
- [ ] **Delivery of the daily digest** — text (like the scorecards) / email / a web page?
      (Leaning text — Teddy lives there.)
- [ ] **Routing / ownership** — Danielle = warranty+ops catch-all? Sofia = customer?
      Alyse = financial? Confirm who owns each category.
- [ ] **Categories / classifier** — the exact buckets Ant sorts into (needs-you / handled /
      noise / financial / customer / vendor-BD). Tune to the real inbox mix.
- [ ] **Which inboxes** — all four, or just the ones Teddy actually watches?
- [ ] **Noise list** — which senders/subjects get auto-archived (build from a real audit).
- [ ] **Timing** — when the digest fires (morning? end of day?).
- [ ] **Escalation** — does a true fire (angry customer, warranty deadline) get an
      immediate text vs. waiting for the daily digest?

## First low-effort step (observe, don't build)
Run an **inbox audit**: sample recent email across all four inboxes and bucket it
(handled / noise / needs-you / financial / customer) so the classifier + filters are
tuned to Teddy's REAL mix, not a guess. Pure read — builds nothing.

## Build order (once decisions land)
1. Inbox audit → real category mix.
2. Gmail filters for the noise + routing (kills the biggest chunk immediately).
3. The "Teddy's Desk" digest agent (classify → surface 🔴, list 🟡, count 🗑️) → deliver
   via the chosen channel. Reuses the api-watch / scorecard pattern.
4. Tune the classifier over a week against real "did this actually need Teddy?" feedback.

---
*Changelog: 2026-08-21 — created as the living spine. Direction set (signal-vs-noise,
Ant daily digest). Awaiting Teddy's decisions on delivery + routing + timing before build.*
