# SEO Lander Audit + Crawl/Index Plan (2026-06-28)

Grounded in 90-day page-level Google Search Console data (`gsc-queries?dim=page`).

## The numbers
- ~1,276 URLs in the sitemap; **1,160 are `<appliance>-repair-<city>` landers.**
- **Only 316 pages got ANY impressions in 90 days → ~960 pages = ZERO impressions.**
- The homepage does the heavy lifting: **10,985 impressions / 244 clicks** (#7.4). Everything else is small.
- The landers that DO surface are the **old directory pages** (`brentwood-tn-appliance-repair/` 550i, `nashville-tn-appliance-repair/` 340i, `new-orleans-...` 306i, `franklin-...` 205i, `clarksville-...` 109i, `mt-juliet-...` 97i, `hermitage-...` 60i) — but ranked **deep (#22–47) with ~0 clicks.**
- Flat `.html` landers (`dryer-repair-mandeville.html`, `refrigerator-repair-hendersonville.html`…) get 20–95 impressions at #30–66.

## The diagnosis
The 1,160 near-identical city landers are a **doorway-page pattern**. Google crawled them, indexed ~9%, and the bulk drag down the site's perceived quality AND waste crawl budget. **Pruning the dead weight is what frees Google to crawl + value the good pages** — fewer, better pages > thousands of thin ones.

## The plan (3 tiers)

### 1. KEEP + ENRICH (the pages that earn impressions)
- Homepage + the 5 service hubs (`dryer-repair`, `washer-repair`, `refrigerator-repair`, `dishwasher-repair`, `oven-repair`) + `dryer-vent-cleaning`.
- The **symptom pages** (`dryer-not-heating`, `washer-not-spinning`, …) — genuinely useful, long-tail, build authority. PRIORITIZE these.
- The **real-market** city pages that pull impressions: Brentwood, Nashville, Franklin, New Orleans, Clarksville, Mt Juliet, Hermitage, Murfreesboro, Antioch, Mandeville, Hendersonville, Hammond, Ponchatoula. (~15–25 pages.)
- Action: unique local content on each keeper + internal links (below).

### 2. PRUNE (the ~960 zero-impression thin landers) — TEDDY'S DECISION
Three options, safest first:
- **(a) noindex** them (`<meta name="robots" content="noindex,follow">` + drop from sitemap). Keeps them live, tells Google to stop wasting crawl + stop counting them against site quality. **Fully reversible. Recommended first step.**
- **(b) 301-redirect** each `<appliance>-repair-<deadtown>.html` → its service hub (e.g. → `/dryer-repair`). Consolidates any scrap of link equity. Permanent-ish.
- **(c) delete.** Cleanest but throws away any latent value.
> Recommendation: **(a) noindex the zero-impression tail now** (reversible), watch indexing of the keepers improve, then decide on redirect/delete later.

### 3. CONNECT (internal linking — the crawl/relevance lever)
- Homepage + service hubs link DOWN to the keeper city pages + the symptom pages (kills orphan status, signals importance, drives re-crawl).
- Each city keeper links to the relevant service hubs + nearby cities.
- Add an "Areas we serve" + "Common repairs" internal-link block to the hubs.

## What needs Teddy's OK
**The prune scope (tier 2).** Retiring ~960 pages is a real move — pick (a)/(b)/(c). I recommend **(a) noindex** as the reversible first step.

## What Claude can do without waiting
- Build the **internal-link blocks** (tier 3) — clearly good, reversible.
- Build a **focused sitemap** that leads with the keepers (homepage, hubs, symptom pages, real-market cities) so Google prioritizes them.
- Generate the **keeper vs dead-weight list** from `gsc-queries?dim=page` for the noindex/redirect script when Teddy picks an option.
