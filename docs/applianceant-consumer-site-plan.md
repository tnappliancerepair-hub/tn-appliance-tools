# Appliance Ant — the two-property split (consumer/DIY site + local repair site)

_Decided with Teddy 2026-08-04. This is the L3 consumer platform becoming real. Permanent memory — the domain + strategy weren't saved anywhere before, so they live here now._

## The domain (looked up via WHOIS/RDAP 2026-08-04)
- **applianceant.com** — Teddy owns it.
- **Registrar: GoDaddy.com, LLC**
- **Registered: 2026-05-14** (reserved when the consumer platform was first sketched).
- **DNS: still on GoDaddy default/parking nameservers** (`PDNS03.DOMAINCONTROL.COM`, `PDNS04.DOMAINCONTROL.COM`) — **parked, not pointed at any host.** Currently shows a GoDaddy placeholder (HTTP 200). Clean slate.
- To bring it live on Netlify: at GoDaddy, either add an **A record → Netlify's load-balancer IP** + a `www` CNAME, OR switch nameservers to Netlify's. (~2 min; exact records handed over at build time.)

## Why two sites (the strategy)
We have **two businesses sharing one roof, and they fight each other:**
- **Local Repair** (Middle TN + LA): cash jobs, wants topical FOCUS to win the map pack + local organic.
- **Nationwide DIY + Parts**: DIYers anywhere/any language, Amazon/parts + affiliate revenue, wants BREADTH.

On one domain, the ~200 nationwide/DIY pages dilute the local site's authority (Google can't tell "what is this site about"), which is a big reason the homepage ranks #1 organic for "refrigerator repair"/"appliance repair" yet the map pack + dilution keep clicks near zero. Splitting concentrates local authority AND lets the DIY brand rank nationwide (a local-typed domain never will).

**Decision: RELOCATE, don't prune.** Nationwide/DIY pages move to applianceant.com; old URLs **301-redirect** to the new home. Nothing is lost — pages live on at the right address, link equity transfers, Amazon/affiliate content lands where it belongs (it *hurts* trust on the local repair site), and cross-domain links back to the repair site count as editorial. **Timing is ideal: most pages are <1 month old → almost no rankings to risk, and applianceant.com starts building authority from day one.**

## The split map (data-driven, from the live sitemap — 2,015 URLs)

### STAYS on tnapplianceexchange.net — LOCAL REPAIR (~1,900 pages)
Rule: **localized intent** ("fix mine, here, now").
- Home, 7 pillars/service/cash (`/`, `same-day-appliance-repair`, `appliance-repair-cost`, `dryer-repair`, `washer-repair`, `refrigerator-repair`, `dishwasher-repair`, `oven-repair`, `dryer-vent-cleaning`)
- 32 city hubs (TN/LA) + **1,170 city×appliance/symptom landers** for the **31 TN/LA cities** we actually serve (antioch … nashville … new-orleans … baton-rouge). *(These are local, but heavily cannibalizing — separate repair-site cleanup: consolidate into the metro hubs. Phase 3, not part of the move.)*
- ~570 **local-language repair pages** (e.g. `/fr/reparation/refrigerateur-new-orleans`, `/hi/marammat/fridge-nashville`, `/ar/tasleeh/thalaja-nashville`) — in-language repair for local communities.
- 43 trust/ops + B2B (how-it-works, about, guarantee, reviews, property-management, apartment, realtor, privacy, terms, careers).

### MOVES to applianceant.com — NATIONWIDE DIY + PARTS (~200 pages)
Rule: **generic/nationwide intent** ("help me fix it / buy the part," anywhere).
- **44** root symptom/DIY pages (`dryer-not-heating`, `washer-wont-drain`, `refrigerator-not-cooling`, …) — generic, no city.
- **18** `/fix/` DIY guides (`/fix/samsung-refrigerator-not-cooling`, …).
- **40** `/repair/` nationwide-city directory — **all out-of-service-area** (Tampa, Miami, Atlanta, Chicago, Dallas, DC, Denver, Vegas, LA, NYC, Houston, Phoenix, VA/KY/FL/MD…). Pure nationwide; belong on the DIY brand (DIY help + find-a-pro + buy-the-part).
- **25** `/brands/` + **20** root brand pages (`whirlpool-appliance-repair`, …) — nationwide brand info.
- **1** `/tools/fault-code-lookup` (DIY tool).
- **~60** nationwide DIY multilingual (the `/LANG/fix/` + quick-check-in-language subpaths across es/ru/fr/vi/zh).
- Each gets the **Amazon/parts-link layer** + "In Middle TN/LA? Get it fixed → tnapplianceexchange.net" cross-link (captures local intent too).

### The clean dividing line
**Generic/nationwide → applianceant.com. Localized (city in the URL, or local-community language repair) → tnapplianceexchange.net.** So `dryer-not-heating` moves; `dryer-not-heating-nashville` stays.

## Phased plan (each step gated on Teddy's approval; nothing live until "go")
1. ✅ **Split map + this doc** (done — read-only).
2. ✅ **Stand up applianceant.com on Netlify** — **LIVE 2026-08-04.** `https://applianceant.com` serves the Appliance Ant consumer homepage with SSL. See "Live infrastructure" below.
3. **Move the ~200 nationwide/DIY pages** over + build the parts/Amazon-link layer + cross-links. *(next)*
4. **301-redirect** the old URLs on the repair site → applianceant.com; register applianceant.com in Search Console; submit its sitemap.
5. **Repair-site local consolidation** (the 1,170 city landers → metro hubs) — separate, careful cleanup to end cannibalization.

## Live infrastructure (Phase 2 — as built 2026-08-04)
- **Netlify site** (2nd site, same "tn appliance" team): slug **`reliable-narwhal-9716df`**, deploys from this GitHub repo, **branch `main`**, **Base directory = `applianceant`** (so Netlify reads `applianceant/netlify.toml`, which sets `publish = "."` → serves the `applianceant/` folder). Static only, no functions.
- **Primary domain: `applianceant.com`** (★ primary). `www.applianceant.com` → 301 redirects to apex. `http://` → 301 forced to `https://` (Force HTTPS on). SSL = Let's Encrypt, auto-provisioned.
- **DNS at GoDaddy** (nameservers still GoDaddy `pdns03/04.domaincontrol.com` — external-DNS approach, NOT Netlify DNS): apex `A @ → 75.2.60.5` (Netlify load balancer); `www → 75.2.60.5` too. Both already correct.
- **Source of the site** lives at repo `applianceant/` (index.html, robots.txt, sitemap.xml, netlify.toml). Main-site `robots.txt` has `Disallow: /applianceant/` and `_redirects` has `/applianceant/* → https://applianceant.com/:splat 301!` so the folder is never indexed under the repair domain.
- **Gotchas burned through (for next time we stand up a 2nd Netlify site from a subfolder):**
  - Saving build settings does NOT trigger a deploy — must push a commit or hit "Trigger deploy → Clear cache and deploy site."
  - "Open production deploy" opens the deploy **permalink** (`<hash>--slug.netlify.app`), which works even when the bare `slug.netlify.app` returns Netlify's **"Site not found"** — a brand-new site's auto-subdomain can lag/never bind, but that URL doesn't matter; ship on the custom domain.
  - The custom domain is what actually serves: claiming `applianceant.com` on the site bound Host→site instantly (HTTP 200 immediately), independent of the flaky `.netlify.app` subdomain.
  - SSL "Provision certificate" modal may show a stale red "certificate parameter is required…" error while the cert actually provisions fine on the backend — verify by hitting `https://` (200), not by trusting the UI message.

## What only Teddy can do
- **GoDaddy DNS** — point applianceant.com at Netlify (records handed over at Phase 2).
- **GBP category** — remove any "Appliance store / Used appliance store" (kills the "used appliance" ghost that still mis-ranks the repair site).

## Long-term
applianceant.com IS the consumer/DIY "Ant" brand from the operating plan (L3). Start as the DIY/parts site; grows into the full consumer platform. The local repair site funds it + is the proving ground; the DIY site builds nationwide reach + parts revenue + feeds the platform.
