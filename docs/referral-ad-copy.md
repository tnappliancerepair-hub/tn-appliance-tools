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

## ★ APPLIANCE-FIRST (the beachhead — run THIS cold) · `meta-ads-create-campaign.js?kit=appliance`
**The play (Teddy's call 2026-09-06):** the product stays all-trades, but marketing aims at appliance
repair FIRST — his turf, his groups, his credibility. Win appliance → expand to HVAC → wider. And a cold
B2B ad converts far better offering a **free guide** than "sign up," so this kit lands on the **lead
magnet**, not the tour.

- **Objective:** Traffic · **Audience:** US 25–65, appliance/home-appliance + small-business-owner +
  field-service-management interests (kit-narrowed) · **Daily budget:** start $20–40 · created **PAUSED**.
- **Landing:** **`tnapplianceexchange.net/guide`** (the free "24/7 Answering + Triage Playbook" → captures
  the lead → reveals the guide inline → warm-DM target for Teddy). NOT the tour/signup for cold traffic.
- **Creative:** the shop video (once filmed — see `docs/shop-demo-video-script.md`); until then `referral-og.png`.
- **Primary text:** Appliance shop owners: every missed call is a missed job. Grab our free 24/7 answering
  + triage playbook — the exact call script + rules a real appliance shop runs on, so an office person with
  zero appliance experience books real jobs. Built by TN Appliance Exchange. 🐜
- **Headline:** Free: Answer Every Call, Book Every Job
- **Description:** The 24/7 call script + triage rules a real appliance shop runs on. No strings.
- **CTA button:** Download → `tnapplianceexchange.net/guide`

**Teddy's go-live runbook (the money flip is yours — Claude does NOT flip it):**
1. Vault via `admin-secrets.html`: `META_AD_ACCOUNT_ID` + `META_ADS_TOKEN` (a token with `ads_management`;
   `META_PAGE_ID`/`SOCIAL_FB_PAGE_ID` is likely already vaulted from the social engine).
   *(Optional bonus: `EMAIL_ENABLED=true` so the free guide also emails the prospect — the page reveals it
   either way, so this is not required.)*
2. `meta-ads-diag?secret=<admin>` → goes green (`configured:true`).
3. `meta-ads-create-campaign?secret=<admin>&kit=appliance&budget=25` (preview — verify appliance targeting
   + `/guide` landing), then add `&apply=1` → creates everything **PAUSED**.
4. **In Ads Manager: review + flip the campaign ACTIVE.** Nothing spends until you do.
5. **Retargeting (cheapest warm money):** in Ads Manager build a Custom Audience off the live pixel
   (`1441529794691715` on the repair site) — people who visited the site / engaged the posts — and run the
   same creative at them landing on `/ant`. (A dedicated retargeting function is a later nicety.)
6. Measure **cost-per-lead / per-DM**, not cost-per-signup — cold B2B SaaS closes on the follow-up, not the click.

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

## ChatGPT Ads — the AI-answer play  ·  live account: `openai-ads-create-campaign.js?appliance=saas`
Buys the "Sponsored" answer when an owner asks ChatGPT what to run their shop on. Account is LIVE +
approved (`OPENAI_ADS_API_KEY` vaulted). **National, $25/day** (~$750 lifetime cap), lands on the
**free-guide lead magnet** (`/guide`), not the tour — captures the owner for a warm follow-up.
- **Headlines:** Run Your Shop for $99/mo · Refer 4 Shops = Yours Free · AI Answers Every Call 24/7
  · Free Setup, No Per-Seat Fee · Housecall Pro Alternative · Built By a Real Repair Shop
- **Descriptions:** Run your whole appliance shop for $99/mo flat — every tech included, free setup.
  Refer 4 buddy shops and yours is free. · AI answers 24/7 and books the job. Bring your data off
  Housecall Pro, Jobber or Workiz in a day. Built by a shop that runs on it.
- **Final URL:** `tnapplianceexchange.net/guide`
- **⚠️ OpenAI Ads has NO paused-then-enable step in code** — so this builder now creates **PAUSED** by
  default and only goes ACTIVE with `&live=1`. Launch: `?secret=&appliance=saas&budget=25&national=1&apply=1`
  (creates PAUSED) → review → `…&apply=1&live=1` (or activate in the OpenAI Ads dashboard) to start spend.
- **Honest gap:** no SaaS-signup conversion feedback yet (the conversion sweep feeds repair jobs) — this
  campaign optimizes on traffic/clicks + `/guide` lead captures until SaaS-signup conversions are wired.

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
