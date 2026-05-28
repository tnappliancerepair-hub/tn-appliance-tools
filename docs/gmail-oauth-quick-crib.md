# Gmail OAuth — Quick crib sheet

**Why we're doing this:** the Netlify functions that read AHS / ServicePower / Frontdoor / Allstate warranty dispatches from `tnappliancerepair@gmail.com` are returning `invalid_grant` — their refresh token died. Once this is fixed, warranty emails land directly in Xano (intake_source=`email_ahs` / `email_servicepower`) instead of going only through HCP. **This is the single blocker for "Xano as source of truth".**

**Time:** 20-30 min. Single Google account login at the right moments.

**Who can do it:** anyone with the password to `tnappliancerepair@gmail.com`. Best if it's Teddy or Alyse since you may need to deal with 2FA / security prompts.

**Detailed walkthrough:** `docs/gmail-oauth-setup.md`. This crib sheet is the short version.

---

## The 5-minute version (if the project already exists in Google Cloud Console)

If a project called "TN Appliance AHS Poller" already exists in the Google account → skip Cloud Console steps, go straight to **Mint new refresh token** at the bottom.

## Full path (if starting fresh)

### 1. Google Cloud Console — set up project (one time, ~10 min)
- https://console.cloud.google.com → sign in as `tnappliancerepair@gmail.com`
- New project named **TN Appliance AHS Poller** (or reuse the existing one)
- APIs & Services → Library → search **Gmail API** → Enable
- OAuth consent screen → External → fill in app name, support email, dev contact (all `tnappliancerepair@gmail.com`) → Add scope `gmail.modify` → Add yourself as test user
- Credentials → Create OAuth client ID → **Desktop app** → name it "AHS Poller Desktop Client" → SAVE the Client ID + Client Secret somewhere safe

### 2. Mint new refresh token (~5 min)
From the repo root on the Mac Mini:
```bash
cd /Users/tpivacek/tn-appliance-tools
node .tmp_smoke/gmail-oauth-init.js
```

Script will:
- Ask for `client_id` → paste
- Ask for `client_secret` → paste
- Print a URL → open in browser → sign in as `tnappliancerepair@gmail.com`
- See "Google hasn't verified this app" → click **Advanced** → **Go to TN Appliance AHS Poller (unsafe)** ← this is expected, app stays in test mode forever
- Click Allow on the permissions prompt
- Browser shows a failed page at `localhost:53682/...` ← that's fine, **copy the entire URL** from address bar
- Extract the `code=...` parameter value (between `code=` and `&scope`)
- Paste back into the terminal script
- Script prints three values: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`

### 3. Update Netlify env vars (~3 min)
Netlify dashboard for `superlative-naiad-233aa7`:
- Site settings → Build & deploy → Environment → Environment variables
- **Replace** the three existing values:
  - `GMAIL_CLIENT_ID`
  - `GMAIL_CLIENT_SECRET`
  - `GMAIL_REFRESH_TOKEN`
- Save

### 4. Trigger a deploy (~2 min)
- Netlify dashboard → Deploys → Trigger deploy → Deploy site
- Wait ~2 min for build to complete

### 5. Verify it works
Hit the poller manually:
```bash
curl -X POST 'https://tnapplianceexchange.net/.netlify/functions/ahs-gmail-poller' \
  -H 'Content-Type: application/json' -d '{}'
```

**Good response:** `{"ok":true,"processed":<some number>}` or similar with messages found.

**Still broken:** `{"ok":false,"error":"invalid_grant"}` → re-mint the refresh token.

Then check Xano for new jobs with `intake_source='email_ahs'`:
```bash
curl 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/check_recent_jobs?limit=20'
```
Look for rows with `intake_source: "email_ahs"` or `"email_servicepower"`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Browser blocks "unverified app" with no Advanced link | You're not logged in as `tnappliancerepair@gmail.com`. Sign out completely + sign back in. |
| Script hangs after pasting code | Code expired (Google gives ~10 min). Re-run script, get fresh URL. |
| Poller still returns `invalid_grant` after update | Check Netlify env vars were SAVED (not just typed and discarded). Re-trigger deploy. |
| Poller returns `Insufficient Permission` | Scope wasn't granted. Re-do step 2, make sure you click Allow on the permissions prompt. |

---

## Same fix unlocks all 3 pollers

The Gmail account is shared. One set of env vars fixes:
- `ahs-gmail-poller` (AHS Home Warranty)
- `servicepower-gmail-poller` (ServicePower / Sears / Choice / many others)
- Any future Allstate / Frontdoor poller we build

Once these are alive, warranty volume flows directly into Xano. Then HCP can sunset.
