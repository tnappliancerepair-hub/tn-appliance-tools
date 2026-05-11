# Gmail OAuth setup — AHS dispatch poller

One-time walkthrough to authorize the Netlify `ahs-gmail-poller` function to read AHS dispatch emails from `tnappliancerepair@gmail.com`. The output is three env vars (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`) that you paste into Netlify. The refresh token persists indefinitely — no further auth needed unless Google revokes it or you change Gmail account passwords / 2FA settings drastically.

## Scope requested

`https://www.googleapis.com/auth/gmail.modify` — read message list + content + attachments, apply/remove labels. Does NOT include send or permanent delete. Least-privilege for a polling function.

## Step 1 — Google Cloud project

1. Go to https://console.cloud.google.com
2. Sign in as `tnappliancerepair@gmail.com`
3. Top bar: click the project dropdown → "New Project"
4. Project name: `TN Appliance AHS Poller`. Click Create.
5. Wait ~30 seconds for the project to provision, then make sure it's selected in the dropdown.

## Step 2 — Enable Gmail API

1. Left nav: "APIs & Services" → "Library"
2. Search "Gmail API" → click it → "Enable"
3. Wait for confirmation that Gmail API is enabled for this project.

## Step 3 — OAuth consent screen

1. Left nav: "APIs & Services" → "OAuth consent screen"
2. User Type: "External". Click Create.
3. App information:
   - App name: `TN Appliance AHS Poller`
   - User support email: `tnappliancerepair@gmail.com`
   - Developer contact: `tnappliancerepair@gmail.com`
4. Scopes screen: click "Add or remove scopes". Search for `gmail.modify`. Check the box. Click "Update" then "Save and continue".
5. Test users screen: click "Add users". Enter `tnappliancerepair@gmail.com`. Click "Save and continue".
6. Summary → "Back to dashboard".

The app stays in **Testing** mode forever — no need to submit for verification because the only test user is the account that owns the project.

## Step 4 — Create OAuth credentials

1. Left nav: "APIs & Services" → "Credentials"
2. Top: "Create Credentials" → "OAuth client ID"
3. Application type: **Desktop app**
4. Name: `AHS Poller Desktop Client`
5. Click Create.
6. The popup shows `Client ID` and `Client secret`. Copy both — you'll paste them into the next step.

## Step 5 — Mint the refresh token

The repo has a one-shot helper script in `.tmp_smoke/gmail-oauth-init.js` (gitignored). It walks through the OAuth dance and prints the three env-var values.

From the repo root:

```
node .tmp_smoke/gmail-oauth-init.js
```

Walkthrough:

1. Script prompts: `client_id:` → paste the Client ID from step 4.
2. Script prompts: `client_secret:` → paste the Client secret.
3. Script prints an authorization URL. Open it in any browser.
4. Sign in as `tnappliancerepair@gmail.com`. You'll see a "Google hasn't verified this app" warning — click "Advanced" then "Go to TN Appliance AHS Poller (unsafe)". This is expected because the app stays in testing mode.
5. Grant the requested permission ("Read, compose, send and permanently delete all your email" — note: the scope we actually request is gmail.modify, which excludes send + permanent delete, but Google's consent screen wording is generic).
6. Google redirects to `http://localhost:53682/oauth2callback?code=...&scope=...`. The page fails to load — that's expected. Copy the entire URL from the browser address bar.
7. Extract the `code` parameter value from the URL. It's the long string between `code=` and `&scope` (URL-decode if needed — paste it raw, the script handles it).
8. Paste the code into the script.
9. Script prints three env-var values. Save them somewhere temporary (not in git).

## Step 6 — Add env vars to Netlify

In the Netlify dashboard for the `superlative-naiad-233aa7` site:

1. Site settings → Build & deploy → Environment → Environment variables
2. Add three new vars:
   - `GMAIL_CLIENT_ID` = (value from step 5)
   - `GMAIL_CLIENT_SECRET` = (value from step 5)
   - `GMAIL_REFRESH_TOKEN` = (value from step 5)
3. Save.

Or via Netlify CLI:

```
netlify env:set GMAIL_CLIENT_ID "<value>"
netlify env:set GMAIL_CLIENT_SECRET "<value>"
netlify env:set GMAIL_REFRESH_TOKEN "<value>"
```

## Step 7 — Trigger a deploy

Either push any small change to `main`, or in the Netlify dashboard click "Trigger deploy" → "Deploy site". The first deploy after these env vars are set is when the scheduled `ahs-gmail-poller` function becomes active.

## Step 8 — Verify

After deploy:

1. Netlify dashboard → Functions → `ahs-gmail-poller` — confirm it appears in the list with a schedule indicator.
2. Click the function to view recent invocations. Schedule is `*/15 * * * *` (every 15 minutes). Wait for the next quarter-hour boundary, or trigger manually via the function URL.
3. Check the function logs for output like:
   - `[ahs-gmail-poller] querying Gmail with: from:noreply@msg.frontdoor.com ...`
   - `[ahs-gmail-poller] found N matching messages`
   - per-message: `[ahs-gmail-poller] message <id> → Xano 200, labeled AHS-Processed`
4. Check Xano `event_log` table for new rows with `action="ahs_email_intake_created"` matching the dispatch_id of any real AHS emails sitting in the inbox.

If you want to test against a known fixture without waiting for a real AHS dispatch:
- The current fixture in the inbox (Robin Jones dispatch from 2026-05-11) will be picked up on first run if it doesn't already have the `AHS-Processed` label.
- That same dispatch has been re-fired multiple times during today's verification — phone dedup will reuse customer 335, but a new job row will be created each time. Acceptable for first end-to-end test; you can mark the email manually with the `AHS-Processed` label afterward to stop re-processing.

## Rotating the refresh token

If you ever need to rotate (compromised, account changes, etc.):

1. Revoke the existing authorization at https://myaccount.google.com/permissions
2. Re-run `.tmp_smoke/gmail-oauth-init.js`
3. Update `GMAIL_REFRESH_TOKEN` in Netlify env

Client ID + secret usually don't need rotation unless leaked.

## Troubleshooting

- **"No refresh token returned"** from the init script: you previously authorized this client with the same account and Google didn't re-mint a refresh token. Revoke the existing authorization at https://myaccount.google.com/permissions and re-run the script. The script already passes `prompt=consent` which usually forces a fresh refresh token.
- **`invalid_grant` errors in Netlify logs:** refresh token expired or was revoked. Re-run the init script and update the env var.
- **`unauthorized` 401 from Gmail API:** check that the OAuth consent screen still has `tnappliancerepair@gmail.com` as a test user.
- **`insufficient scopes`:** you may have missed `gmail.modify` in step 3. Re-add the scope, re-run the init script.
