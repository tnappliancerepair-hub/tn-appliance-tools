# PROJECT: Spanish Local-SEO Landing Pages — ASAP
_Turn `/es/` from 0 search impressions into a real, low-competition lead channel. 2026-07-28._

## Why (the case)
- `/es/` + the other language dirs get **0 GSC impressions in 90 days** — because they're homepage *translations*, not landing pages targeting real Spanish queries.
- **Spanish is the ONE language worth it:** real Hispanic communities in **Nashville metro** (Mexican/Central American) and **New Orleans / Kenner / Metairie** (Honduran/Cuban), and **almost no local competitor builds real Spanish repair pages** → low-competition, underserved audience.
- Same engine that ranks the English city pages, pointed at Spanish local queries.

## What to build (pilot → scale)
**Pilot batch first (~30 pages): top Hispanic cities × top appliances.** Prove indexing + impressions, then scale to all cities.

### URL structure (mirror the English pattern, in Spanish)
`/es/reparacion-de-{aparato}-{ciudad}/`
- e.g. `/es/reparacion-de-refrigeradores-nashville/`, `/es/reparacion-de-lavadoras-kenner/`

### Pilot cities (highest Hispanic density in the two markets)
- **TN:** Nashville, Antioch, Murfreesboro, Smyrna, La Vergne, Hermitage
- **LA:** Kenner, Metairie, New Orleans, Gretna, Hammond

### Appliances (Spanish terms — regional synonyms matter)
| English | Primary Spanish | Include synonym |
|---|---|---|
| Refrigerator | refrigerador | **nevera** (Caribbean/NOLA), heladera |
| Washer | lavadora | — |
| Dryer | secadora | — |
| Dishwasher | lavaplatos | **lavavajillas** |
| Oven/Stove | estufa | horno |
"Appliances" (universal) = **electrodomésticos**

### Target keywords per page
- `reparación de {aparato} en {ciudad}`
- `reparación de electrodomésticos {ciudad}`
- `técnico de {aparato} cerca de mí`
- `servicio de reparación de {aparato}`

## Requirements (do it right — thin auto-translation is what failed)
1. **Real Spanish content per page** — symptom→cause in Spanish, a local intro, repair-vs-replace, safety flags (gas/240V) — NOT a machine translation of the English boilerplate. Mirror the English UNIQUEBODY depth.
2. **hreflang** on every page — each Spanish page ↔ its English equivalent (`hreflang="es"`, `hreflang="en"`, `x-default`). This is what tells Google these are language alternates.
3. **Spanish schema** — LocalBusiness + FAQPage (`inLanguage: "es"`).
4. **CTA → the Spanish intake** (`/es/revision-rapida.html` carrying `?socio=`/church codes) — the conversion path already exists.
5. **Sitemap** — add every `/es/` URL; bump lastmod.
6. **Internal links** — from the English city page → its Spanish alternate, from `/es/` homepage → a Spanish city hub, and city-hub → its appliance pages (mesh).
7. **IndexNow ping** all new URLs (Bing/Yandex) + submit sitemap + Request Indexing in GSC for the pilot set.

## How (build method)
- Script-generate from a Spanish content template + a `{ciudad × aparato}` matrix — the same approach that built the English landers (`lander-unique.py` / `la-city-faq.py`). One script → the pilot batch.
- Human/Claude-authored Spanish content blocks per appliance (5 appliances × real content), localized per city — reusable, not per-page hand-writing.

## Success metric
- **Week 1–2:** pages indexed (GSC shows them), first impressions on `/es/` (was 0).
- **Month 1:** ranking for `reparación de {aparato} {ciudad}` in the pilot cities; first Spanish organic clicks → `/es/revision-rapida.html`.
- Then **scale** to all service cities.

## Ownership
- Claude: build the script + Spanish content templates + generate the pilot batch + hreflang + schema + sitemap + IndexNow.
- Teddy: review the Spanish reads naturally (or Danielle/a Spanish speaker eyeballs a sample), then Request Indexing in GSC.

_Status: QUEUED — ASAP. Pilot = ~30 pages (11 cities × 5 appliances, trimmed to the strongest)._
