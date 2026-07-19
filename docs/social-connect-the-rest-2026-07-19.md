# 🔌 Connect the rest — YouTube · TikTok · X (2026-07-19)
Goal: **hands-off auto-posting on every platform.** Facebook + Google are already automated. Instagram rides the Facebook connection (see the Instagram steps in `facebook-aggressive-free-launch-2026-07-19.md`). YouTube, TikTok, and X each gate auto-posting behind **their own developer approval** — that's their rule, not ours. So the move is: **start all three approval clocks now**, use the "post everywhere" copy as 30-second paste in the meantime, and flip each to auto the moment its approval lands.

**What only Teddy can do:** create the developer app on each platform (needs the account login) + submit for review. **What Claude does:** the moment creds land in the vault, wire the connector + fold it into the auto-poster. Every cred goes to the **vault via admin-secrets.html** — never chat.

Redirect/callback base for all three (already our pattern): `https://tnapplianceexchange.net/.netlify/functions/<platform>-oauth-callback`

---

## 📺 YouTube (Data API v3) — evergreen search, own OAuth
**Why:** the 543K-view classic already lives here; Shorts get pushed hard and rank in Google forever. Approval is the lightest of the three (no formal audit for own-channel uploads in most cases; may hit an OAuth-verification screen).

**Teddy's steps (~15 min):**
1. **console.cloud.google.com** → reuse the existing Google Cloud project (the one with Ads/Search Console/GBP) or create "TN Appliance".
2. **APIs & Services → Library → enable "YouTube Data API v3".**
3. **OAuth consent screen** → make sure it's **Published/Production** (Testing mode expires the token in 7 days — same footgun we hit before).
4. **Credentials → Create OAuth client ID → Web application.** Authorized redirect URI: `https://tnapplianceexchange.net/.netlify/functions/youtube-oauth-callback`
5. **Vault** (admin-secrets.html): `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`.
6. Tell Claude → he serves the one-time authorize link → you approve → refresh token auto-vaults (`YOUTUBE_REFRESH_TOKEN`).

**Scope needed:** `https://www.googleapis.com/auth/youtube.upload` (+ `youtube.readonly` for stats).
**Then auto:** Claude wires `youtube-upload.js` (resumable upload) into the poster so a video post auto-uploads as a Short/video with the paste-ready title + description.

---

## 🎵 TikTok (Content Posting API) — biggest raw reach, needs an audit
**Why:** the AI-answers-at-2am demos are made for it; a good clip can go viral with zero ad spend. **This is the slowest** — TikTok requires an app review/audit before Direct Post is granted (days→weeks). Start the clock now; post by hand meanwhile.

**Teddy's steps (~20 min):**
1. **developers.tiktok.com** → log in with the TikTok account → **Manage apps → Connect an app.**
2. Fill the app: name "TN Appliance", category Business, describe use = "scheduling our own appliance-repair shop's videos."
3. **Add the "Content Posting API" product** → request the **Direct Post** capability (this is what triggers the audit).
4. Register redirect URI: `https://tnapplianceexchange.net/.netlify/functions/tiktok-oauth-callback`
5. Submit for review. (You'll likely need to record a short screen-demo of the intended flow — Claude will draft exactly what to show.)
6. **Vault:** `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`.
7. When approved → tell Claude → authorize link → `TIKTOK_REFRESH_TOKEN` vaults → auto-posting on.

**Meanwhile (hands-on but fast):** post the launch clips manually from the phone with the TikTok caption from social-drafts.html. Fastest path to reach while the audit runs.

---

## 𝕏 X / Twitter (API v2) — claim the ground, API optional
**Why:** you own the account, never used it. Lowest lift = **claim + look real** so the name shows up when searched. Auto-posting is possible but the free tier is finicky and rules shift — do the profile first, decide on the API after.

**Phase 1 — now (no dev app):** Claude delivers a profile kit (bio, banner text, pinned tweet) + paste-ready ≤280 versions of every post. You paste-and-post in 30 sec each. **This alone checks the "everywhere" box.**

**Phase 2 — auto (only if worth it):**
1. **developer.x.com** → Developer Portal → create a Project + App "TN Appliance".
2. Set app permissions to **Read and Write.**
3. Enable **OAuth 2.0**, callback: `https://tnapplianceexchange.net/.netlify/functions/x-oauth-callback`
4. **Vault:** `X_CLIENT_ID`, `X_CLIENT_SECRET` (OAuth2) — and note the free tier's monthly post cap.
5. Tell Claude → authorize → `X_REFRESH_TOKEN` vaults → auto-posting within the tier limits.

---

## Order of operations (so nothing waits on anything)
1. **Instagram** — Teddy's account switch + app perms → Claude re-runs OAuth (`?ig=1`) → cross-post auto. *(This week.)*
2. **YouTube** — Teddy's OAuth client → Claude wires upload. *(Quick.)*
3. **TikTok** — Teddy submits the audit **now** so the clock runs; manual posting meanwhile. *(Slow — start first.)*
4. **X** — profile kit + paste now; API later if worth it.

**Guardrails (all platforms):** only true claims · never the boss's cell in a post · own accounts + genuine participation only, no scraping/auto-DM · draft-first stays the rule — nothing posts until Teddy says GO.
