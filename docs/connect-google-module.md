# Connect Google — the Local-SEO / marketing module (spec)

**The pitch to the shop:** *"Click one button, and Ant runs your Google."* Auto-posts, review
auto-replies, screened job-photo posting, Q&A seeding, and a health score — the exact engine
already running for TN Appliance, turned into a per-tenant add-on. Turns Ant from "runs your
back office" into "runs your back office **and fills your funnel**." It's the first marketing
rail (§04) and it's already priced (`local_seo` add-on in `platform/plans.js`).

## Why it's mostly built already (TN's engine → productize)

Everything below exists and runs live for TN — the work is **per-tenant OAuth + a dashboard
tile**, not building the engine:

| Capability | TN function today | Productize = |
|---|---|---|
| Auto-post to GBP (2×/wk) | `gbp-post-generator` / `gbp-post` | run per tenant on their location |
| Review auto-reply (4–5★ auto, ≤3★ flag-to-owner) | `gbp-review-responder` / `-autoreply` / `review-reply-watch` | per tenant, owner-approval for negatives |
| Screened job-photo posting (Vision: no people/interiors/serials) | `gbp-photo-autopost` | per tenant, from their captured job media |
| Q&A seeding (owner Q&A) | `gbp-qanda-seed` | per tenant |
| Profile health / audit | `gbp-profile` (read), `seo-scorecard` | per-tenant score tile |
| Google Ads (later stack) | `google-ads-*` tooling | managed campaigns per tenant |

## Architecture — one "Connect Google" button

1. **Per-tenant Google OAuth.** Today TN uses ONE shared `GBP_REFRESH_TOKEN` (the "Ant Ads"
   Google client). Productizing = each tenant grants access to **their own** Google Business
   Profile via an OAuth flow; store the refresh token per `company` (a `google` block in
   `company.settings`, or a `tenant_google_token` row — service-side only, never the browser).
2. **A dashboard tile** on `owner.html`: "📍 Connect Google" → OAuth → then a Local-SEO card
   (health score, last post, reviews replied, photos posted, "near-limit / needs attention").
3. **The engine runs per tenant.** The existing GBP crons iterate connected tenants (like the
   usage-digest cron does), each acting on that tenant's `location_id`. Owner-approval gate on
   negative reviews stays.
4. **Billing:** flip `features.local_seo` on when the `local_seo` add-on is in their subscription
   (already wired through `platform-features` / the webhook). The tile only shows when the
   feature is on.

## Honest gating (what's real vs. what needs Google)

- **Each shop must grant GBP access** (the OAuth consent) — can't manage a profile we're not
  authorized on.
- **Google API tiers.** TN's first-party access (managing our *own* profile) is approved and
  live. Managing **other shops' profiles at scale** is a bigger Google approval — the
  **third-party / agency access** tier (Business Profile API allow-listing + quotas). Plan for
  that review before mass rollout; until then, onboard tenants first-party (each connects their
  own, we act on their behalf under their grant).
- **Rate/quota limits** apply per Google's API — pace posts/replies (already paced in TN's crons).
- **Q&A API** specifically has had activation lag (TN hit it) — same caveat per tenant.

## Sell-it framing (for the vertical landings + owner tile)

- "Your competitors post to Google once a year. Ant posts for you every week."
- "Every 5-star review gets a warm reply in your voice — automatically. Every 1-star gets you
  a heads-up before it's answered."
- "We turn your finished jobs into Google photos — screened so no customer faces, no serial
  numbers, ever."
- Ties to reviews being **the #1 map-pack lever** (proven on TN): more reviews naming the city
  → higher local rank → more calls.

## Build order

1. Per-tenant Google OAuth (start + callback) storing a per-company refresh token.
2. Owner-tile: Connect button + Local-SEO status card (reads `seo-scorecard`/`gbp-profile` for
   that tenant).
3. Make the GBP crons tenant-aware (iterate connected companies).
4. Negative-review approval flow per tenant (reuse TN's flag pattern).
5. Later: managed Google Ads as a higher tier; apply for Google third-party/agency access for
   scale.

**Gate to sell it live:** per-tenant OAuth + the tile + one tenant connected end-to-end
(TN itself is tenant #1 — dogfood it). Then it's a checkbox in the à-la-carte builder.
