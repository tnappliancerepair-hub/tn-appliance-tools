# Google Business Profile API — access status + ready-to-submit request (2026-07-04)

Goal: programmatically READ our Google reviews and POST personalized replies (and keep
hours/services/posts accurate). This upgrades the current **draft-and-tap** review engine
(`review-reply-watch` — Ant drafts a reply + texts Teddy a one-tap post link) to fuller
automation (auto-post the 4–5★ ones). It is an upgrade, NOT a blocker — the draft-and-tap
engine already delivers the hard 90% (the good drafts).

## Where it actually stands (verified in Google Cloud Console 2026-07-04)
- **Google Cloud project:** "My First Project" = `project-fb170b47-a89e-4176-9d1`, **project
  number `1340849724014`** (same project as Gmail + Google Ads). Org: tnappliancerepair-org.
- **Managing Google account:** `tnappliancerepair@gmail.com` (owns the project + manages the
  Business Profile — Teddy to confirm the profile shows under it at business.google.com).
- **APIs enabled ✅:** My Business Account Management API, My Business Business Information API,
  Business Profile Performance API. (The legacy **Google My Business API v4** — the one that
  actually reads reviews + posts replies — is deprecated/removed from the Library; it rides on
  the allowlist, nothing to toggle.)
- **QUOTA = 0 QPM ❌ (verified on My Business Account Management API → Quotas & System Limits:
  "Requests per minute · Value 0 · Adjustable No").** 0 QPM = **project NOT allowlisted.** So
  the reviews API can't be called yet. Approval flips it 0 → 300.
- Prior access request: **case 4-9470000004382** (submitted ~6/24, ETA 7-10 business days).
  No case reply found in tnappliancerepair@ or tnappliance@ inboxes → it stalled or was
  silently denied.

## THE MOVE: (re)submit the Basic Access request
Fast path: reply to the original case thread (search `tnappliancerepair@gmail.com` for
"4-9470000004382" or "Business Profile API"). Else submit fresh at
**support.google.com/business/contact/api_default → "Application for Basic API Access."**

**Form fields:**
- Name: James "Teddy" Pivacek
- Email / Google account: tnappliancerepair@gmail.com
- Google Cloud project number: `1340849724014` (ID `project-fb170b47-a89e-4176-9d1`)
- Business name: TN Appliance Exchange
- Website: https://tnapplianceexchange.net
- Business Profiles managed: 1 (our own, verified)
- Prior case #: 4-9470000004382

**Use-case text (paste — written to pass review):**
> We are TN Appliance Exchange, an appliance-repair company serving the Nashville, TN area and
> southeast Louisiana. We manage our **own single, verified Google Business Profile**, which has
> roughly **1,100 customer reviews**. We're requesting **Basic API access** to (1) programmatically
> **read our reviews and post timely, personalized replies** to them, and (2) keep our business
> information (hours, services, posts) accurate. We reply to every customer by name and reference
> their specific repair; with ~1,100 reviews and steady new ones, replying by hand is our
> bottleneck. This is strictly **first-party use on our own Business Profile** — we are not building
> a third-party management platform and will not access any other business's data. Google Cloud
> project number **1340849724014**. Follows our earlier request, **case 4-9470000004382**.

## Known footgun
Google may flag the applicant email (`@gmail.com`) not matching the website domain
(`tnapplianceexchange.net`) — the same thing that bounced the Google Ads application. The
"strictly first-party, our own single profile" language is written to head that off; if they
push back, reply like we did for Ads (confirm business + link content pages).

## After approval (quota → 300) — what Claude builds
- Vault the OAuth refresh token (shares the same OAuth client as Google Ads / GSC).
- Read reviews via the v4 API (`accounts.locations.reviews.list`); auto-post the 4–5★ replies
  our engine already drafts (`reviews.updateReply`); keep negatives draft-and-tap (human first).
- Wire into the existing `review-reply-watch` so drafting stays, posting goes automatic.

## Honest priority
Background item. The draft-and-tap engine already works; the API just removes the manual tap.
Submit the request, let it cook, don't sweat the queue.
