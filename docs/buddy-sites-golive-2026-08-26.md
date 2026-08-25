# 🌐 Buddy sites — domain + go-live runbook (2026-08-26)

Two starter sites are built, productionized, and staged in the repo — ready to deploy the
moment each owner says yes. This is the exact path from "he likes it" → live on his own
domain with HTTPS.

- 🔧 **Classic Automotive** (Greg) — `sites/classic-automotive/` — target domain `classicautomotivetn.com`
- 🐠 **Music City Aquatics** (Brandon Pack) — `sites/music-city-aquatics/` — target domain `musiccityaquatics.com`

Each folder = a complete static site: `index.html` (full standalone page, proper `<head>`,
viewport, canonical, Open Graph, favicon, LocalBusiness + FAQPage schema), `robots.txt`,
`sitemap.xml`. No build step, no dependencies — pure static, drops onto any host.

Design/preview (private artifacts — hit **Share** before texting the link):
- Greg: https://claude.ai/code/artifact/2efd3bbe-64d6-4c80-8c0f-73d0561c6f6d
- Brandon: https://claude.ai/code/artifact/2dba213e-00a7-4809-ab10-1e7436f164a5

---

## The 5 steps to go live (per shop, ~30–45 min once content is final)

### 1) Register the domain (~$10–15/yr)
Recommend **Cloudflare Registrar** (at-cost, no markup) or **Namecheap**. Suggested names
(confirm availability — have a backup):
- Classic Automotive: `classicautomotivetn.com` · fallbacks `classicautolebanon.com`, `gregsclassicauto.com`
- Music City Aquatics: `musiccityaquatics.com` · fallback `.net`
- **Decide who owns/pays:** simplest is the shop owner buys it (they own their brand) OR
  Teddy buys as part of onboarding and bills it back. Either works — just be consistent.

### 2) Swap in the owner's real content (the only pre-launch to-do)
Every placeholder is tagged in the page with a dashed marker so it's obvious. Replace:
- **Photos** — the gallery tiles + the owner "portrait" (`📷` / "Add photo" tags)
- **Prices** — the `$XX` fields (Greg: alignment $120 + free-diagnostic are already real; Brandon: plan prices)
- **Address + ZIP** — the `[bracketed]` fields in the Visit/Contact block
- **Hours** — Greg's Mon–Fri 8–5 is already in; Brandon's are `[bracketed]`
- **Reviews** — swap the 4 sample cards for his real Google reviews (and then it's honest to add an aggregateRating to the schema — I'll do that when real reviews land)
- **Phone** — ⚠️ **confirm before launch:** Greg = (931) 632-4734 (his Ann line, spells GREG); Brandon = (615) 457-3171 (his listed number — verify it's current)
> When the owner sends real content, I finalize `sites/<shop>/index.html`, commit, and it's launch-ready.

### 3) Deploy the static site
**Fastest (recommended): Netlify Drop** — go to `app.netlify.com/drop`, drag the
`sites/<shop>/` folder → live on a `*.netlify.app` URL in ~30 seconds, auto-HTTPS.
**OR (better long-term): Netlify from Git** — "Add new site → Import from Git" → this repo,
set **base directory = `sites/<shop>`**, publish dir = same, no build command. Every future
edit auto-redeploys. (Each shop = its own Netlify site, free tier is plenty for a one-pager.)

### 4) Point the domain at it
In the Netlify site → **Domain settings → Add a domain** → enter the domain →
- Easiest: use **Netlify DNS** (it gives 4 nameservers → set them at the registrar). Netlify
  then issues the Let's Encrypt SSL automatically.
- OR keep DNS at the registrar/Cloudflare and add the records Netlify shows (an `A`/`ALIAS`
  to Netlify's load balancer for the apex + a `CNAME` for `www`). Netlify provisions HTTPS
  once DNS resolves.
- Set the primary domain + force HTTPS + a `www` → apex redirect (Netlify one-click).

### 5) Verify + index
- Load the domain on phone + desktop, test the **Call button** dials the right number.
- Submit the domain to **Google Search Console** (add property → verify via DNS TXT) and
  submit `sitemap.xml`. This is how it starts ranking.
- Create/claim the shop's **Google Business Profile** and put the new domain as the website
  — the map-pack + the site reinforce each other (same playbook as TN).

---

## What I need from Teddy to pull the trigger (per shop)
1. ✅ **Owner said yes** + which **domain** to register (or that he registered one).
2. **Real content pack** — photos, real prices, address, hours, a few Google reviews.
3. **Confirm the phone number** on the site.
4. A Netlify account to deploy under (TN's existing one is fine, or a fresh one per shop).

## Cost snapshot
- Domain: ~$10–15/yr each · Hosting: **$0** (Netlify free tier) · SSL: **$0** (auto).
- So a live, fast, SEO-structured site ≈ the cost of the domain. Easy bundle with the Ant platform.

## Notes
- These are **separate businesses** — staged under `sites/` in this repo for convenience +
  version control; can be moved to their own repos later with zero rework (pure static).
- The artifact previews are the design; `sites/<shop>/index.html` is the deployable truth —
  keep edits in the repo file once we're past the preview stage.

## Changelog
- **2026-08-26** — Built + staged both production sites (`sites/classic-automotive`,
  `sites/music-city-aquatics`) from the approved artifact designs; wrote this runbook.
