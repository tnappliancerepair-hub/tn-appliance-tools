# GSC Request-Indexing Checklist — Multilingual Landing Pages
_Get Google to crawl + index the 375 non-English landers fast. 2026-07-29._

## What this is / why it works
- We shipped **375 landing pages + 7 hubs across 7 languages** (es, vi, ru, ar, zh, hi, fr), all in the sitemap, all IndexNow-pinged (that covers **Bing/Yandex only — Google ignores IndexNow**).
- For **Google**, the two levers are: (1) the **sitemap** (already submitted — passive, slow), and (2) **URL Inspection → Request Indexing** (manual, fast, but **rate-limited to ~10–12 URLs/day per property**).
- So we don't submit all 375 by hand. We submit a **handful of flagship pages per language** — the hub + the biggest-community/top-appliance page. Google indexes those, sees they're real, follows the internal links + sitemap, and crawls the rest on its own. **The flagships pull the cluster in.**

## Before you start (2-minute setup check)
1. Go to **search.google.com/search-console**.
2. Confirm the property is **`tnapplianceexchange.net`** (a **Domain** property is best — it covers http/https/www and all subfolders). If you only have a URL-prefix property, make sure it's `https://tnapplianceexchange.net/`.
3. **Sitemaps** (left menu) → confirm `sitemap.xml` shows **Success** and the discovered-URL count is in the hundreds (it should now include all the /es/ /vi/ /ru/ /ar/ /zh/ /hi/ /fr/ URLs). If it looks stale, re-submit `sitemap.xml`.

## How to Request Indexing (the click path — same for every URL)
1. Paste the full URL into the **search bar at the very top** of GSC ("Inspect any URL in tnapplianceexchange.net").
2. Wait for the inspection to run (~10–30 sec).
3. Click **"Request Indexing"**.
4. It queues (~1 min), then says "Indexing requested." Move to the next URL.
5. If you hit "Quota exceeded," **stop for the day** — pick up the rest tomorrow.

> Tip: do these on desktop. Each URL is ~30–60 sec. Day 1 list ≈ 10–12 minutes.

---

## DAY 1 — hubs + #1 flagship per language (12 URLs)
_Hubs first: one hub links to that language's whole city×appliance set, so indexing it exposes everything under it._

```
https://tnapplianceexchange.net/vi/sua-chua/
https://tnapplianceexchange.net/vi/sua-chua/tu-lanh-new-orleans.html
https://tnapplianceexchange.net/ru/remont/
https://tnapplianceexchange.net/ru/remont/holodilnik-nashville.html
https://tnapplianceexchange.net/ar/tasleeh/
https://tnapplianceexchange.net/ar/tasleeh/thalaja-nashville.html
https://tnapplianceexchange.net/zh/weixiu/
https://tnapplianceexchange.net/zh/weixiu/bingxiang-brentwood.html
https://tnapplianceexchange.net/hi/marammat/
https://tnapplianceexchange.net/hi/marammat/fridge-brentwood.html
https://tnapplianceexchange.net/fr/reparation/
https://tnapplianceexchange.net/fr/reparation/refrigerateur-new-orleans.html
```

## DAY 2 — Spanish + #2 flagship per language (10 URLs)
_Spanish is the biggest opportunity (was 0 impressions — hreflang now fixed), so give it 3 slots._

```
https://tnapplianceexchange.net/es/reparacion/refrigerador-nashville.html
https://tnapplianceexchange.net/es/reparacion/lavadora-nashville.html
https://tnapplianceexchange.net/es/reparacion/refrigerador-nueva-orleans.html
https://tnapplianceexchange.net/vi/sua-chua/may-giat-kenner.html
https://tnapplianceexchange.net/ru/remont/stiralnaya-mashina-nashville.html
https://tnapplianceexchange.net/ar/tasleeh/ghassala-antioch.html
https://tnapplianceexchange.net/zh/weixiu/xiyiji-nashville.html
https://tnapplianceexchange.net/hi/marammat/washing-machine-franklin.html
https://tnapplianceexchange.net/fr/reparation/lave-linge-kenner.html
https://tnapplianceexchange.net/fr/reparation/lave-vaisselle-metairie.html
```

**Why these cities/appliances:** each is the **densest community for that language × the most-searched appliance** (refrigerator/washer). New Orleans/Kenner for Vietnamese & French, Nashville for Russian/Chinese/Spanish, Brentwood/Franklin for Hindi & Chinese (Indian/Chinese professional families), Antioch for Arabic. Refrigerator and washer are the two highest-volume repair searches, so they're the best "front door" per cluster.

---

## After you submit — what to watch (don't expect same-day)
- **Timeline:** Google usually crawls a Requested URL within **a few days to ~2 weeks**. The rest of the cluster follows over **2–4 weeks** via the sitemap + internal links.
- **Week 1–2 check:** in GSC, inspect any submitted URL → it should flip from "URL is not on Google" to **"URL is on Google."**
- **Impressions:** **Performance** report → filter by page (e.g. `Page contains /es/reparacion/`) → you should see impressions climbing from **0**. This is the real proof the language is ranking in its own language.
- **Pages report:** **Indexing → Pages** → watch the "Indexed" count rise; if pages sit in "Crawled – currently not indexed" for 3+ weeks, that's a content-quality signal worth a look (unlikely here — the pages are unique per city).

## Repeat cadence (optional, high-leverage)
- Each day you have a spare 10 minutes, submit **~10 more** from the sitemap — work down the biggest cities first (Nashville, Antioch, New Orleans, Kenner, Metairie, Brentwood, Franklin, Murfreesboro).
- You don't have to submit all 375 — once ~30–40% of a language's cluster is indexed and getting impressions, Google reliably picks up the rest on its own.

## What's already handled (so you don't redo it)
- ✅ Sitemap includes all 382 URLs (lastmod bumped).
- ✅ Reciprocal hreflang across all 9 languages (en/es/vi/ru/ar/zh/hi/fr/x-default) — this is what tells Google "these are language alternates, index each in its own language" (the fix for Spanish's 0-impressions).
- ✅ Bing/Yandex already pinged via IndexNow.
- ⛔ **Google-only remaining lever = this checklist (Request Indexing) + the sitemap.** There is no API to force Google indexing; the manual submits above are the fastest legit path.
