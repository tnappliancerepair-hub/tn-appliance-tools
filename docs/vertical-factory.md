# The Vertical Factory — stand up a new `[Trade] Ant` in an afternoon

**One factory, many front doors.** Every vertical (Appliance Ant, Auto Repair Ant, Aquarium
Ant, …) rides the SAME platform, the SAME brain, the SAME billing. A vertical is a **config +
a domain**, never a fork. This is the discipline that keeps the moat: one colony, not N dumb
brains; one codebase, not N copies to patch.

## What's shared vs. what forks

| Built ONCE — shared by every vertical | Forks per vertical (all you add) |
|---|---|
| GitHub repo (this one) | A **domain** → `autorepairant.com` (DNS) |
| One Netlify site, serving **many domains** | A **row in `platform/verticals.js`** |
| One brain runtime (Mac mini / cloud loop) | A **`trade_profile`** (workflow + vocabulary) |
| One Claude / Telnyx / Stripe account | That trade's **knowledge** (earned over time) |
| Multi-tenant DB (RLS) + signup + billing + Ann phone | *(optional)* per-brand Telnyx 10DLC registration |

The branded landing (`platform/vertical.html`) is **one file** that reads the hostname →
picks the vertical row → themes itself. `applianceant.com` and `autorepairant.com` are the
same file wearing different faces.

## The motion — 4 steps

1. **Add the vertical row** in `platform/verticals.js`: `key`, `brand` (`[Trade] Ant`),
   `trade` (must match a `trade_profile` key), `domains`, `tagline`, `hero`, `proof[]`,
   `accent`, `emoji`. Commit + deploy.
2. **Stage the trade** if it's new to the platform (existing: appliance, automotive, aquarium,
   furniture, dealership):
   `GET platform-provision?action=addtrade&trade=<key>&secret=<admin>` — creates the
   `trade_profile` (unit noun, service verb, intake fields). Idempotent.
3. **Point the domain** at this Netlify site (DNS): add the domain as a custom domain / alias
   in Netlify, set the registrar's DNS to Netlify. `vertical.html`'s hostname resolver does the
   rest — no per-domain code.
4. **Done.** The vertical's landing is live at the domain and funnels into
   `signup.html?trade=<key>&v=<key>` — which provisions a real tenant with that workflow,
   spins up its board + portal + tech app, and (with the shop's number/details) an Ann phone
   assistant. All trade-agnostic, so it works the same day.

## The one honest caveat

Signup + phone AI + database are **instant** for a new vertical (they're trade-agnostic).
The trade's **troubleshooting brain is earned** — Appliance Ant has 49k jobs + a fault-code
library behind it; Auto Repair Ant starts empty and deepens as its shops feed it. Instant
utility, earned moat. So: **open a vertical when a real flagship shop is pulling on it**, not
speculatively — the shop is what starts filling that trade's brain.

## Current verticals (`platform/verticals.js`)

| Vertical | trade | domain | flagship | live |
|---|---|---|---|---|
| Appliance Ant | appliance | applianceant.com *(owned)* | TN Appliance | ✅ |
| Auto Repair Ant | automotive | autorepairant.com | Classic Automotive (Greg) | ready |
| Aquarium Ant | aquarium | aquariumant.com | Music City Aquatics (Brandon) | ready |
| Furniture Ant | furniture | furnitureant.com | Mid Tenn Furniture (Brandon) | ready |
| Dealer Ant | dealership | dealerant.com | NextGen Motors (Jake) | ready |

**Open decisions:** confirm/grab the vertical domains; pick vertical #2's flagship to launch
first; keep auto-repair and dealership as *separate* verticals (different workflows already).
