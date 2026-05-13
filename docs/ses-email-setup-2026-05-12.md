# SES email setup — Teddy execution checklist (steps 11–13)

> Phase A1 Workstream gate. Until this is done, the `send-email` Netlify function dry-runs every call. After this is done and `EMAIL_ENABLED=true` is set on both Netlify and Xano, real emails fire to verified recipients (sandbox limits apply). Step 13 closes with one live test email to Danielle, then Claude can approve schedule activation for the ServicePower poller.

**Execute in order. Each step depends on the previous.**

---

## Step 11A — Rotate `EMAIL_SHARED_SECRET`

The current value was briefly visible in conversation transcript during the step 8 env-var debug. Rotate before flipping `EMAIL_ENABLED=true`.

### 11A.1 — Generate new 32-byte hex value (PowerShell)

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
Write-Host $secret
```

Copy the 64-char hex string. Don't paste it into any chat or git-tracked file. Hold it in your terminal scratch buffer for the next two commands.

### 11A.2 — Update in Netlify (production context)

```powershell
netlify env:set EMAIL_SHARED_SECRET $secret --context production
```

### 11A.3 — Update in Xano

Xano admin UI → Settings → Environment variables → find `EMAIL_SHARED_SECRET` → paste the same 64-char value → Save.

**Both sides MUST be identical.** Mismatch will produce `401 unauthorized` on every send-email call.

### 11A.4 — Verify rotation took effect

After rotation, fire the existing step-8 test script to confirm Test 2 still passes with the new secret:

```powershell
# From repo root
$env:GMAIL_CLIENT_ID = netlify env:get GMAIL_CLIENT_ID
$env:GMAIL_CLIENT_SECRET = netlify env:get GMAIL_CLIENT_SECRET
$env:GMAIL_REFRESH_TOKEN = netlify env:get GMAIL_REFRESH_TOKEN

# Flip Xano EMAIL_ENABLED=true temporarily (admin UI), then:
node .tmp_smoke/test-sp-dedup-gate.js verify-rotation
# Then unset Xano EMAIL_ENABLED again.
```

Expected: event_log shows `email_sent` with `mode: "netlify_dry_run"`. If it shows `email_failed` with `error: "unauthorized"`, the secrets don't match — re-verify both env vars.

---

## Step 11B — AWS SES domain identity

### 11B.1 — Open SES console

URL: **<https://us-east-2.console.aws.amazon.com/ses/home?region=us-east-2#/identities>**

Sign in with the AWS account that owns `TN_AWS_ACCESS_KEY_ID` (the one currently used for S3).

### 11B.2 — Create domain identity

- Click "Create identity"
- Identity type: **Domain**
- Identity name: `tnapplianceexchange.net`
- "Use a custom MAIL FROM domain": **YES**
  - MAIL FROM subdomain: `mail` (so MAIL FROM = `mail.tnapplianceexchange.net`)
  - Behavior on MX failure: "Use default MAIL FROM domain"
- DKIM signatures: **Enabled**, type: **EasyDKIM**
- Publish DNS records: **Manually** (not Route 53 — we use Netlify DNS)
- Tags: skip
- Click "Create identity"

SES shows a confirmation screen with:
- **3 DKIM CNAME records** (token-based, unique to your domain)
- **1 MX record** for the MAIL FROM subdomain
- **1 TXT record** (SPF) for the MAIL FROM subdomain

**Don't close this tab.** Copy each of the 5 records exactly.

---

## Step 11C — Check existing root SPF in Netlify DNS

Before adding the root SPF record, check what's already there. Only ONE SPF record per domain is valid — if one exists, we must merge.

### 11C.1 — Inspect existing TXT records on the apex

Netlify dashboard → DNS panel for `tnapplianceexchange.net` → look for any TXT records on the root (`@` or blank Name field).

Specifically look for any value starting with `v=spf1`.

### 11C.2 — Two outcomes

**Outcome A — No existing SPF.**  Add the new SPF record as written in step 11D.6 below.

**Outcome B — Existing SPF.** Don't add a second record. Paste the existing value back to Claude (Slack / chat / etc.), and we'll merge `include:amazonses.com` into the existing record. Then update the existing TXT record value, don't create a new one.

---

## Step 11D — Add DNS records to Netlify DNS panel

For each record below: Netlify DNS panel → "Add new record" → fill in Type / Name / Value / TTL.

### 11D.1 — DKIM CNAME 1 of 3

| Field | Value |
|---|---|
| Type | CNAME |
| Name | `<token1>._domainkey` (from SES console — Name column of DKIM record 1) |
| Value | `<token1>.dkim.amazonses.com` (from SES console) |
| TTL | 3600 |

### 11D.2 — DKIM CNAME 2 of 3

Same shape, token2 values from SES console.

### 11D.3 — DKIM CNAME 3 of 3

Same shape, token3 values from SES console.

### 11D.4 — MX (MAIL FROM bounce handling)

| Field | Value |
|---|---|
| Type | MX |
| Name | `mail` |
| Value | `feedback-smtp.us-east-2.amazonses.com` |
| Priority | 10 |
| TTL | 3600 |

### 11D.5 — TXT (SPF for MAIL FROM subdomain)

| Field | Value |
|---|---|
| Type | TXT |
| Name | `mail` |
| Value | `v=spf1 include:amazonses.com ~all` |
| TTL | 3600 |

### 11D.6 — TXT (SPF for root domain) — **only if Outcome A in step 11C**

| Field | Value |
|---|---|
| Type | TXT |
| Name | `@` (or leave blank — depends on Netlify UI) |
| Value | `v=spf1 include:amazonses.com ~all` |
| TTL | 3600 |

If Outcome B (existing SPF), DON'T add this. Wait for the merged value from Claude and update the existing record.

### 11D.7 — TXT (DMARC)

| Field | Value |
|---|---|
| Type | TXT |
| Name | `_dmarc` |
| Value | `v=DMARC1; p=none; rua=mailto:tnappliancerepair@gmail.com` |
| TTL | 3600 |

`p=none` is monitor-only mode (recommended for the first 2-4 weeks; surfaces unauthorized forgery via aggregate reports). Can tighten to `p=quarantine` or `p=reject` later once you've observed no false positives.

---

## Step 11E — Wait for SES domain verification

Back in the SES console identity page for `tnapplianceexchange.net`:

- Status flips from "Verification pending" → **"Verified"** within **5-30 minutes** after the 3 DKIM CNAMEs propagate.
- DKIM status flips from "Pending" → **"Successful"** at the same time.
- MAIL FROM status flips from "Pending" → **"Successful"** after the MX + SPF for `mail.tnapplianceexchange.net` propagate.

If status stays "Pending" for >1 hour, recheck the DNS records in Netlify — typos are the #1 cause.

---

## Step 11F — Verify recipient identities in SES sandbox

Until production-access is granted (separate request), SES sandbox lets us send to **verified recipient identities only**. Need to verify two:

### 11F.1 — Verify `danielle.tnappliance@gmail.com`

- SES console → Identities → "Create identity"
- Identity type: **Email address**
- Identity name: `danielle.tnappliance@gmail.com`
- Create identity

SES sends a verification email to Danielle. She clicks the link. Status flips to "Verified".

### 11F.2 — Verify `tnappliancerepair@gmail.com`

Same flow, identity name `tnappliancerepair@gmail.com`. Verification email lands in the business inbox; Teddy clicks the link.

---

## Step 12 — Flip `EMAIL_ENABLED=true` on both sides

### 12.1 — Trigger Netlify deploy to refresh env cache

Netlify env-var changes need a deploy refresh before they're visible to function runtime (verified during step 8 debug). To save a "no-op deploy", you can wait until you're ready to flip — the act of setting the env var triggers a deploy on its own in modern Netlify, but a manual trigger guarantees it.

Either:
- Push any small commit to `main`, OR
- Netlify dashboard → Deploys → "Trigger deploy" → "Deploy site"

### 12.2 — Set Netlify `EMAIL_ENABLED=true`

```powershell
netlify env:set EMAIL_ENABLED true --context production
```

### 12.3 — Set Xano `EMAIL_ENABLED=true`

Xano admin UI → Settings → Environment variables → find `EMAIL_ENABLED` → set value `true` → Save.

### 12.4 — Trigger another Netlify deploy

After setting `EMAIL_ENABLED=true` in Netlify env, trigger one more deploy to pick up the new value at function runtime. Same as 12.1.

Wait ~60 seconds for deploy to finish.

---

## Step 13 — Live email test

Claude executes this. Single synthetic DEDUP_FAILED POST → real SES send to `danielle.tnappliance@gmail.com`.

When you're ready, message Claude: **"DNS verified, EMAIL_ENABLED flipped, run step 13."**

### Expected outcome

- Response `success: true`, `actions[0].dedup_status: "FAILED"`, `actions[0].action: "created_job"`
- `event_log` row `action="email_sent"`, `mode: "live"`, `message_id: <SES message ID>` (a real AWS SES message ID, not the `dry-run-not-enabled` sentinel)
- **Danielle receives the alert email** in `danielle.tnappliance@gmail.com` within ~30 seconds
- Email body matches the template: subject `[TN Appliance] Manual customer dedup needed - Job #<id>`, body containing Job ID, Call #, source, customer name (or NOT PROVIDED), phone (or NOT PROVIDED), address (or NOT PROVIDED)

### If anything fails

- `event_log` `action="email_failed"` with `error: "Email address is not verified..."` → recipient identity verification didn't complete. Re-do step 11F.
- `event_log` `action="email_failed"` with `error: "Domain identity is not verified..."` → DKIM still pending. Wait longer at step 11E.
- `event_log` `action="email_failed"` with `error: "unauthorized"` → `EMAIL_SHARED_SECRET` mismatch between Netlify and Xano. Re-do step 11A.
- Danielle reports the email landed in spam → tweak DMARC, check SPF/DKIM alignment in the email headers Danielle's Gmail received.

---

## After step 13 passes

Claude reports back. Teddy approves:
1. **Schedule activation** — uncomment the `[functions."servicepower-gmail-poller"]` block in `netlify.toml`, commit, push. Cron starts at the next 15-minute boundary.
2. **Production access request** in SES console (optional, only needed when we want to send to non-verified recipients).
3. **Phase A2 / A3 next steps** per the Phase A build order.

---

## Quick reference — env vars after this is complete

| Where | Var | Value |
|---|---|---|
| Netlify (production) | `EMAIL_SHARED_SECRET` | `<rotated 64-hex value from 11A.1>` |
| Netlify (production) | `EMAIL_ENABLED` | `true` |
| Netlify (production) | `TN_AWS_ACCESS_KEY_ID` | (unchanged — existing S3 value) |
| Netlify (production) | `TN_AWS_SECRET_ACCESS_KEY` | (unchanged — existing S3 value) |
| Xano | `EMAIL_SHARED_SECRET` | `<same value as Netlify>` |
| Xano | `EMAIL_ENABLED` | `true` |
