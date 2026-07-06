# Social Automation Plan — Facebook · Instagram · TikTok (2026-07-05)
Teddy asked: can Ant automate FB leads / FB SEO / TikTok / Instagram? Here's the
plan — what's legit + automatable, what to avoid, what Ant builds, and the exact
setup steps to start the API-approval clock. Owned-demand growth (Pillar 1 of the
competitive-defense plan) — **sits behind this week's two fires (calls + TDRs).**

## ⛔ The bright line — what we DO NOT build
**No scanning Facebook groups for "my dryer broke" posts + auto-DMing strangers.**
It violates Meta's terms, gets business accounts banned, and is spammy — off-brand
for a transparency-first shop. Any tool that promises it is scraping. We don't.

## ✅ What's legit, automatable, and worth it

| # | Piece | What it does | Needs | Ant's part |
|---|---|---|---|---|
| 1 | **Auto-post FB + IG** | On-brand posts (repair tips, before/after, the wrapped truck, seasonal, per-city) auto-published to the FB Page + IG on a schedule | Meta app + Page token + IG Business linked | **Reuses the GBP post engine** — build-ready; draft-and-tap today, auto when token lands |
| 2 | **DM + comment auto-reply** | Someone comments/messages the page ("do you fix LG fridges?") → Ant answers in seconds, like it does SMS. The *legit* "catch people who need help" | Messenger API + Meta app review | Same brain as customer-sms-inbound, new channel |
| 3 | **FB Lead Ads → instant text-back** | Paid lead-form submissions hit Ant via webhook → text/call within seconds (speed-to-lead) | You run lead ads; leadgen webhook | Wire the webhook → existing intake/SMS |
| 4 | **TikTok / Reels — Ant scripts, human shoots** | Ant writes the hooks, scripts, captions, hashtags + cadence; someone films 20-sec clips (truck, a fix, repair-vs-replace tip). Auto-post via TikTok API once approved | TikTok dev app (audit) + a person to film — **great job for Alec** | Scripts + captions + schedule; can't film |

**"Facebook SEO" reality:** FB/IG posts don't rank in Google — but an active page +
real reviews + photos build local trust and give leads a place to land. The efficient
move is **one content engine feeding GBP + Facebook + Instagram at once** (same posts,
three channels) + the review engine we already run.

## 🔧 Teddy's setup — start the approval clock now (same dance as Google/Amazon)
1. **Meta app** — developers.facebook.com → Create App (Business type). Note the App ID + Secret.
2. **Link the accounts** — connect the TN Appliance **Facebook Page** and the **Instagram Business/Creator** account (IG must be a Business account linked to the Page).
3. **Request permissions** (triggers Meta app review — the gated part, days–weeks):
   `pages_manage_posts`, `pages_read_engagement`, `pages_messaging`,
   `instagram_basic`, `instagram_content_publish`, `leads_retrieval`.
4. **Get a long-lived Page access token** → vault it: `SOCIAL_FB_PAGE_TOKEN`,
   `SOCIAL_FB_PAGE_ID`, `SOCIAL_IG_USER_ID`. (Vault via admin-secrets.html — never chat.)
5. **TikTok (separate track)** — developers.tiktok.com → app → Content Posting API
   (requires audit). Vault `TIKTOK_*` when approved. Video content still needs a human.

Until the tokens land, everything runs **draft-and-tap** (Ant texts the drafts, you
post) — exactly how the GBP generator works today. Nothing is blocked from starting.

## 🛠️ What Ant builds (build-ready, flips live on token)
- **`social-post-generator`** — weekly content pack: FB post + IG caption/hashtags +
  a TikTok script/hook for Alec. Draft mode texts it now; auto-publishes to FB + IG
  when the Meta token is vaulted. Kill switch `SOCIAL_POST_GENERATOR=false`, `?dryrun=1`.
- **`social-inbound`** (later) — FB/IG comment + DM auto-reply through the customer brain.
- **`fb-leadgen-webhook`** (later) — Lead Ads → instant Ant follow-up.
- **`social-api-watch`** — inbox watcher for the Meta/TikTok approval emails (mirrors
  google/amazon watchers) so you don't babysit the inbox.

## 🗓️ Sequence
1. **Now:** `social-post-generator` in draft mode (value today, no API) + start the Meta app/review + arm the approval watcher.
2. **On Meta token:** flip auto-posting live (FB + IG); wire DM/comment auto-reply.
3. **If running paid:** lead-ads webhook → instant text-back.
4. **TikTok:** Ant scripts + Alec shoots from day one (no API needed to start); auto-post when the TikTok app is approved.

## 🧭 Guardrails
- No group scraping / stranger DMs (ban risk). Only our own page/accounts + paid lead ads.
- Every channel has a kill switch + a draft-first mode. Nothing auto-posts until we've
  eyeballed the drafts and you say go.
- Growth is great — but the phone + TDRs come first. Don't fill a funnel that drops leads.

---
*Changelog: 2026-07-05 created from the "automate social?" discussion.*
