# Lift AWS SES out of sandbox — so signup login emails actually deliver

**Why this matters:** the platform's login/onboarding emails (the "here's your sign-in link" a shop
gets after signing up) send through **AWS SES in region us-east-2 (Ohio)**. SES is currently in
**sandbox mode**, which means it will ONLY deliver to a handful of pre-verified addresses
(today: `tnappliancerepair@gmail.com` and `danielle.tnappliance@gmail.com`). Any other address —
including `tnappliance@gmail.com` and every real customer's email — is silently rejected, so the shop
gets created but the email never arrives.

Nothing on our side is broken or turned off: `EMAIL_ENABLED=true`, the SES credentials are set, and the
sending domain is verified. The ONLY thing gating delivery to arbitrary addresses is the sandbox.
Requesting **production access** removes the recipient-verification requirement and raises the sending
limits. AWS usually responds within ~24 hours.

This is a one-time AWS-console action. It does not require any code change or redeploy on our side —
the moment AWS approves, login emails just start delivering to any address.

---

## Before you start
- You'll sign in to the **AWS Console** as the **root user** (your AWS account email).
- When AWS asks for the 6-digit MFA code, get it from the **Authy** app on your phone.

## The steps (~5 minutes to submit)

1. **Sign in** at `https://console.aws.amazon.com` (root user email → password → Authy MFA code).

2. **Set the region to US East (Ohio) `us-east-2`** using the region selector in the top-right of the
   console. This is critical — SES sandbox status, the verified domain, and the request are all
   **per-region**, and our sending lives in Ohio. If you request production access in the wrong region
   it does nothing for us.

3. Open **Amazon SES**. In the left nav go to **Account dashboard**. You'll see a banner saying your
   account is in the sandbox with a **"Request production access"** button (also reachable under
   **Account dashboard → Request production access**). Click it.

4. **Fill out the request form:**
   - **Mail type:** Transactional
   - **Website URL:** `https://tnapplianceexchange.net`
   - **Use case description** (paste and lightly edit):
     > We send transactional account emails to appliance-repair shops that sign up for our software
     > platform (AssistAnt). Each email is triggered only by a shop submitting our signup form, and
     > contains a one-time sign-in link plus their account details. We do not send marketing or bulk
     > email through SES. Volume is low (a few dozen per day at most). We only email addresses that
     > were entered on our own signup form (explicit opt-in), and we monitor SES bounce and complaint
     > metrics and stop sending to any address that fails.
   - **Additional contacts / preferred language:** your email + English.
   - **Acknowledge** you'll comply with the AWS Acceptable Use Policy and only send to recipients who
     requested the email → check the box.

5. **Submit.** You'll get an AWS Support case. Approval typically lands within ~24 hours (they may reply
   with a follow-up question first — answer it in the same case).

## While you wait (optional, gets YOUR own emails working immediately)
Verify `tnappliance@gmail.com` as a sandbox recipient so your own future login emails land even before
production access is granted:
- SES → **Identities** → **Create identity** → **Email address** → `tnappliance@gmail.com` → Create.
- Amazon emails that address a verification link — click it. Now sandbox can deliver to it.
(This is a stopgap for known addresses only; it does NOT scale to customers — production access is the
real fix.)

## After AWS approves
- Nothing to flip on our side (`EMAIL_ENABLED` is already `true`). Login emails begin delivering to any
  address automatically.
- **Test it:** have someone sign up with a fresh, real email (or ping me and I'll fire a test send) →
  confirm the sign-in email lands in the inbox. Then self-serve signups can go live.

## Sanity checks (should already be true — glance, don't redo)
- SES → **Identities**: `tnapplianceexchange.net` shows **Verified** with DKIM enabled. (It already is —
  that's why live sends to the two verified addresses work today.) If it ever shows unverified, that
  DNS/DKIM setup has to be restored before production access helps.
- SES enforces a sustained **5% bounce** and **0.1% complaint** ceiling. A signup-only, opt-in flow is
  well within these; just don't blast old/unverified lists through SES.

---

*One-time AWS action, no code change. Reference for when you open self-serve signups to outside shops.*
