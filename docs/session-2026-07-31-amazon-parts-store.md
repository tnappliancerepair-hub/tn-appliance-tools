# Session handoff — Amazon parts store + fitment (2026-07-31 night) — READ FIRST TOMORROW

Long build night on the Amazon parts-store initiative. Everything below is committed +
pushed to `main` (live on Netlify). Pick up in the morning from "OPEN / TOMORROW".

## ✅ BUILT + LIVE + VERIFIED tonight
- **Component knowledge layer** (`_lib/ant/component-knowledge.js` + `component-info.js`): curated,
  tech-authored per-component **failure symptoms + how-to-test + safety + links to our /fix pages**.
  17 components seeded (evaporator motor, condenser fan, start relay, water valve, drain pump,
  dryer element, thermal fuse, ice maker, oven element/igniter, lid lock, door gasket, + the 4
  universal SKUs). 100% reliable (no daemon, no guessing). Verified live.
- **Write-once → both-surfaces generator** (`listing-generator.js` + `listing-studio.html`):
  one grounded source → **Amazon** (title/5 bullets/description/A+ modules/backend terms/fitment)
  + **website** (/fix HTML block + FAQ/HowTo JSON-LD + meta). **Multilingual: Amazon EN+ES,
  website all 7** (es/ru/vi/ar/zh/hi/fr), per-language schema + RTL for Arabic. Verified (ES title
  came back clean, preserving Whirlpool/OEM/TN Appliance). Cockpit: `/listing-studio.html`.
  - Bug fixed: translations were empty because the 4k-token cap truncated the JSON → raised to 8k
    + robust JSON slice. Now works.
- **Fitment widget** (`fitment-check.js` + `fits.html`): part-confirm + tiers + live stock/supersession
  from Marcone API + the component knowledge. Hardened: **hard appliance gate** (a fridge query can
  never return an oven part — was a real bug), and **no part named on a 'verify' verdict** (no
  low-confidence guesses shown). QR-prefillable (`?model=&pn=`).

## 🔒 DECISIONS LOCKED (governing docs)
- **90%+ fitment accuracy = license to sell. No SKU lists without verified ground-truth fitment.**
  Curated catalog, never a dump. → `docs/storefront-accuracy-architecture-2026-07-31.md`.
- **Prediction (ant-brain-predict) is DEMOTED** — too thin/noisy, don't trust it, keep improving on
  a separate track. Never a customer-facing promise. It now operates only inside the fit-verified set.
- **Ground truth first, Ant Brain on top later** (once Layer 1 solid + clean data accumulates).
- **Sourcing map:** universal parts → Marcone TJ90/PRO (LIVE); off-brand → ERP (app submitted) +
  Marcone; **control boards → CoreCentric reman** (ServicerParts invite submitted) for Samsung/LG/
  discontinued that Marcone misses; hoses → **bulk stainless-braided** (Certified/Eastman), NOT
  Marcone (too pricey/incomplete); dryer vent → Deflecto via Marcone + Dundas Jafine bulk.
  → `docs/amazon-parts-store-tiers-2026-07-31.md`, `docs/erp-outreach-2026-07-31.md`.
- **Competition + wedge:** → `docs/amazon-competition-and-wedge-2026-07-31.md` (beat flippers on
  tier ladder + fitment/low-returns + real techs + external-traffic flywheel).
- **Website⇄Amazon synergy:** → `docs/website-amazon-synergy-2026-07-31.md` (traffic flywheel +
  ~10% Brand Referral Bonus + Attribution + QR capture + shared content; NO backlinks from Amazon).

## 🔑 KEY TECHNICAL FINDINGS (proven, don't re-litigate)
- **Marcone/mSupply API is PART-NUMBER-ONLY.** Proven with the correct schema: part# via
  `/parts/lookup` (single) + `/parts/productlistlookup` (batch, `items:[{itemId,make,skuType}]`,
  `lookupType` enum Default/ByBranch/ByZipCode/ByGeoCode). A **model** as itemId → **400 "not found"**
  (treated as a part#). **No model→parts, no part→compatible-models field.** Part response carries
  price/dealer/list/stock/supersession(`crossReferenceParts`)/subParts — NO fitment.
- **The daemon is NOT needed** for the storefront: the API covers price/stock/supersession/batch/
  ordering; per-SKU fitment (captured at listing time) covers "does it fit." The daemon was only for
  the universal "any model → its parts" oracle, which is DEFERRED. (Daemon was also down/fragile.)
- **Amazon SELLER API (SP-API):** Seller Central account verified + SP-API developer profile
  APPROVED (Jul 3 emails confirm). Creds were never vaulted (Teddy was after the buyer API then).
  Connector foundation built: `_lib/spapi.js` + `sp-api-test.js` (owner-gated probe). Buyer LWA token
  is buyer-scoped (403 on seller endpoint) — need real SP-API creds.

## ⏭️ OPEN / TOMORROW
**Teddy's gates (only he can do):**
1. **Vault SP-API creds** from sellercentral.amazon.com/developer/register → "Add new app client"
   → LWA Client ID/Secret → Authorize (self) → refresh token. Vault as `SPAPI_CLIENT_ID`,
   `SPAPI_CLIENT_SECRET`, `SPAPI_REFRESH_TOKEN` (+ `AMAZON_SELLER_ID`, `AMAZON_MARKETPLACE_ID`) via
   admin-secrets.html. Then tell Claude → re-run `sp-api-test` (flips to seller_verified) → wire
   listings/orders push + pull.
2. **Start the trademark** on "TN Appliance Exchange" → unlocks Brand Registry → A+ + Brand Store.
3. (In flight, no action) ERP distributor app + CoreCentric ServicerParts invite — watch inbox for replies.

**Claude's build queue (no gates):**
- "Buy this part" module on the GSC-ranking pages + /fix pages → matching Amazon SKUs (+ Attribution tags once enrolled).
- QR-in-box insert → fits.html + review + booking (returns-killer + audience capture).
- Curated universal-SKU beachhead (hoses/vent/hard-starts) + per-SKU fitment capture step — NEEDS Teddy's SKU picks.
- Expand component-knowledge coverage (more components) as we list them.

**After SP-API creds land:** enroll Amazon Attribution; wire the generator's output → SP-API listing push; feedback-monitor + auto-review-request (from `docs/amazon-reputation-and-fitment-spec-2026-07-31.md`).

## 🧹 Notes
- Owner-gated diagnostics left in place (harmless, reusable): `sp-api-test.js`, `msupply-probe.js`.
- FedEx = production LIVE (verified earlier today). Office password moved to vault (`antsystem`).
