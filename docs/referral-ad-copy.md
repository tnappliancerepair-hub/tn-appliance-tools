# The Ant Army — targeted ad copy (paste-ready, per channel)

The referral program as a **targeted ad to shop owners**. Every claim below is true to our own
pages ($99/mo flat all-techs-included, free setup, Ann answers 24/7, bring-your-data, built by a
real shop, refer 4 = free / past 4 = $25/mo cash). Creative: **`/referral-og.png`** (1200×630,
the gold "Refer a shop. Get $25/mo off." card) — or `/assistant-og.png` for a product-first look.
Landing: **`assistant247.net`** (the prospect tour + Start-free-trial CTA).

Honest note on "targeting": **Meta** targets by *audience* (small-business owners / the trades) —
best fit for reaching owners. **Google** targets by *intent* (owners searching for repair
software). **ChatGPT** buys the answer when an owner asks an AI what to run their shop on.

---

## Meta (Facebook / Instagram) — the audience play  ·  built: `meta-ads-create-campaign.js`
**Objective:** Traffic · **Audience:** US, age 25–65, small-business-owner + the-trades interests
· **Daily budget:** start ~$25 · **Creative:** `referral-og.png` · **Page:** TN Appliance Exchange
· created **PAUSED** (flip live in Ads Manager).

- **Primary text:** Run your whole appliance shop for $99/mo flat — every tech included, free
  setup. Bring a buddy shop on board and take $25/mo off your bill for each one. Four, and yours
  is free. Built by a real repair shop that runs on it every day. 🐜
- **Headline:** $99/mo — Refer 4, Yours Is Free
- **Description:** Free setup. Ann answers 24/7. Bring your data off Housecall Pro in a day.
- **CTA button:** Learn More → `assistant247.net`

_Go-live: vault `META_AD_ACCOUNT_ID` + `META_ADS_TOKEN` (ads_management) via admin-secrets.html →
`meta-ads-diag?secret=` goes green → `meta-ads-create-campaign?secret=&apply=1` (PAUSED) → review +
flip live in Ads Manager._

---

## Google Search — the intent play  ·  built: `google-ads-create-campaign.js?appliance=saas`
National, leads on the same hook, targets owners actively shopping for software.
- **Keywords (phrase):** appliance repair software · field service software · housecall pro
  alternative · jobber alternative · workiz alternative · software for appliance repair business ·
  ai receptionist for small business · field service scheduling software · 24/7 answering service
  for repair business
- **Headlines (≤30):** Run Your Shop for $99/mo · Refer 4 Shops = Yours Free · AI Answers Calls
  24/7 · Free Setup, No Per-Seat Fee · Housecall Pro Alternative · Built By a Repair Shop · Bring
  Your Data in a Day · Flat $99, All Techs Included
- **Descriptions (≤90):** One system runs your whole shop — $99/mo flat, every tech included, free
  setup. · Refer buddy shops, get $25/mo off each — 4 and yours is free. Built by a real shop.
- **Final URL:** `assistant247.net`

_Staged now as a live PREVIEW (no spend). Launch: `google-ads-create-campaign?secret=&appliance=saas&apply=1`
(creates PAUSED) then `&enable=1` (or google-ads-enable) to turn on. ~$20–30/day to start._

---

## ChatGPT Ads — the AI-answer play  ·  prepped: `openai-ads-create-campaign.js?appliance=saas`
Buys the "Sponsored" answer when an owner asks ChatGPT what to run their shop on. Dark until the
OpenAI key is vaulted (`OPENAI_ADS_API_KEY` + `OPENAI_ADS_PIXEL_ID`).
- **Headlines:** Run Your Shop for $99/mo · Refer 4 Shops = Yours Free · AI Answers Every Call 24/7
  · Free Setup, No Per-Seat Fee · Housecall Pro Alternative · Built By a Real Repair Shop
- **Descriptions:** Run your whole appliance shop for $99/mo flat — every tech included, free setup.
  Refer 4 buddy shops and yours is free. · AI answers 24/7 and books the job. Bring your data off
  Housecall Pro, Jobber or Workiz in a day. Built by a shop that runs on it.
- **Final URL:** `assistant247.net`

---

## LinkedIn — the free organic B2B lane (no paid API; you post)
Tightest owner-targeting that exists (job title + industry), but paid is manual/pricey — run it
**organic** per `docs/linkedin-seo-playbook.md`. Sample post:

> The best way to run an appliance repair shop in 2026 is one flat system, not five per-seat tabs.
> Here's the model we built (and run our own shop on): $99/mo flat, every tech included, free setup,
> an AI that answers every call 24/7 and books the job. And a referral twist for the trade — bring
> 4 buddy shops on and yours is free. Long live the moneymakers. 🐜
> _(link in the first comment → assistant247.net)_

---

## Guardrails
- Only true claims (no invented stats) — honesty is the brand.
- The referral is the *hook*; the ad sells the product. A cold viewer isn't a referrer yet — they
  become a paying shop, then their card turns them into one.
- Everything ships **PAUSED / preview / dark** — no spend until Teddy flips it.
