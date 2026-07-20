# TikTok App Review submission — TN Appliance (Content Posting API)

**Status 2026-07-20:** Sandbox integration PROVEN end-to-end. OAuth connected
(refresh token vaulted), and `tiktok-upload-test` pushed a real TN Appliance
video into the @tn.appliance.exch TikTok drafts via FILE_UPLOAD
(`status 201`, `publish_id v_inbox_file~v2.7664604210297636878`).

Now: record the demo video + fill the use-case explanations + Submit for review.
Audit takes days→weeks.

---

## What we're requesting
- **Products:** Login Kit + Content Posting API
- **Scopes:** `user.info.basic`, `video.upload`
- **Mode:** "Upload to TikTok" (video.upload → the user's drafts/inbox). NOT
  Direct Post. The business owner opens TikTok, reviews, adds caption, and taps
  Post. Nothing publishes without a human.

## Use-case / scope explanations (paste into the review form)

**How your product uses `user.info.basic`:**
> We use Login Kit with user.info.basic solely to confirm which TikTok account
> the business owner has connected (display name + avatar) so our dashboard shows
> "Connected as @tn.appliance.exch." No profile data is stored beyond the account
> id needed to route uploads to the right account.

**How your product uses `video.upload` (Content Posting API):**
> TN Appliance Exchange is a family appliance-repair business. Our internal tool
> lets the owner write one post and send it to all of the business's own social
> channels. For TikTok, when the owner approves a post, our server uploads the
> already-produced video into the owner's own TikTok drafts (inbox) via the
> Content Posting API. The owner then opens TikTok, adds the final caption, and
> publishes it themselves. We only ever upload the business's own original repair
> videos to the business's own connected account. We do not post on behalf of
> other users, do not auto-publish, and do not collect content from anyone else.

**Data handling / who uses it:**
> Single business (the account owner). Videos are the business's own original
> content. We store only the OAuth refresh token (encrypted in our secret vault)
> and the account open_id. No third-party or end-user data is involved.

## Demo video to record (screen recording, ~60–90s)
Record on the phone or desktop. Show the full loop:

1. Open our internal post tool (`social-drafts.html` — enter the admin secret) →
   show the pending post with the TikTok copy block + the video.
2. Click the **"⬆ Upload to TikTok drafts"** button in the TikTok block → confirm →
   it shows **"✓ In your TikTok drafts"** (a real on-screen action, not narration).
3. Cut to the TikTok app on @tn.appliance.exch → open the notification/inbox →
   show the "video ready to post from another app" entry → tap it → the video
   opens in TikTok's editor.
4. Add a caption and show the Post button (you can actually post it or stop at
   the editor — either proves the flow).

Narration line: "Our tool uploads our own repair video into our own TikTok
drafts; we review and post it inside TikTok."

> The button lives in `social-drafts.html` (TikTok block) and calls
> `tiktok-upload-test` → FILE_UPLOAD into the inbox. This is the exact screen to
> record.

## After approval (flip to production)
1. Clear the sandbox creds so the connector falls back to production
   (`TIKTOK_SANDBOX_CLIENT_KEY` / `_SECRET` in the vault) — the connector already
   prefers sandbox when present, production otherwise.
2. Re-run the OAuth once on production (`/.netlify/functions/tiktok-oauth-start`)
   to vault a production refresh token.
3. Wire the TikTok cross-post into the social-campaign approve flow (behind a
   `TIKTOK_CROSSPOST_LIVE` flag, mirroring the Instagram cross-post) so approving
   a video post also drops it into TikTok drafts.
4. Repoint the `social-drafts.html` "⬆ Upload to TikTok drafts" button at the
   production cross-post (behind `TIKTOK_CROSSPOST_LIVE`) BEFORE removing
   `tiktok-upload-test.js` — the button currently calls that endpoint. Then remove
   `tiktok-upload-test.js` + `tiktok-vault-check.js` (diagnostics).

## Footguns learned
- FB videos live on `fbcdn` (unverified domain) → PULL_FROM_URL is blocked.
  Use FILE_UPLOAD (download bytes → push to TikTok). Already implemented.
- Single-chunk FILE_UPLOAD covers videos ≤ 64 MB (our clips are ~2–3 MB / 30s).
- Sandbox target user must be added (done: @tn.appliance.exch).
