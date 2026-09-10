<!-- Recovered 2026-09-10 from the 'Shop automation setup' session, which was holding a
420KB plan at the approval prompt - large enough that opening the session crashed the
phone app, so the button could never be tapped. The plan is preserved here in full;
the pending prompt was cleared so the session is usable again. Nothing had executed. -->

# 🛡️ ACTIVE (2026-09-09) — SIGNUP→PAY→PROVISION→LOGIN hardening: audit findings + remediation punch-list

## Context / why
Teddy: "make the platform bulletproof / no flaws" → after the invite-removal + `criticalSecret`
hardening this session, I ran **four parallel read-only audits** of the now-live public self-serve
signup chain. **Two areas PASS clean and need no work:** (a) RLS cross-tenant isolation is airtight —
every tenant table is `using`+`with_check` scoped to `current_company_id()`, service-key functions
resolve the company server-side from the session JWT (never a client param), the portal is
token-scoped; (b) empty-shop first-run renders clean (money math divide-by-zero-guarded, every list
has an empty state, boot watchdog + supa-guard prevent white screens). The **502-class dangling-ref
re-check came back CLEAN** (the `adminBypass` hotfix held). Everything below is the remaining flaw
list, ranked. Standing rule: I do NOT flip an outward/money flag or vault a key — SES-production +
the config-flag calls are Teddy's.

## 🔴 CRITICAL — strands, cross-wires, or exposes a paying customer

### 1. Slug "reservation" is a READ, not a lock → two shops can collide into ONE tenant
`platform-signup.js:122-129` only *reads* `company` to pick a free slug; nothing is created/locked
until the webhook fires post-payment. `platform-provision.js:940-965` then "reuses by slug." So two
owners who sign up as the same shop name in one window (or one abandons + a second reuses the name)
both stamp the same slug into Stripe metadata, both pay, and provision B attaches B's owner `app_user`
(role=owner) onto **A's existing company** → customer B lands inside customer A's tenant (cross-tenant
data bleed + a second owner on someone else's shop). The code comment claims a guarantee it doesn't
provide. **Fix (surgical, recommended):** in the provision path, when a company with that slug already
exists, check the incoming `owner_email` against that company's owner — if it's a DIFFERENT owner,
this is a collision → **generate a fresh unique slug + create a NEW company** instead of attaching the
second owner. (Full slug-reserve-at-signup is heavier — needs a pending-company row + abandoned-
checkout cleanup; the attach-guard is the low-risk fix that makes cross-wiring impossible.)

### 2. Webhook Stripe-key asymmetry is STILL live after the criticalSecret change
`platform-billing.js:48` checkout key = `PLATFORM_STRIPE_SECRET_KEY || STRIPE_SECRET_KEY` (has a
fallback); `platform-stripe-webhook.js:246` = `criticalSecret('PLATFORM_STRIPE_SECRET_KEY') || ''`
(**no fallback**, 500 at :247-250). `criticalSecret` fixed the *read reliability*, not the *fallback*.
If a deploy has only `STRIPE_SECRET_KEY` set, every checkout succeeds but every webhook 500s → the
tenant depends entirely on the redirect path, and the operator alert (inside `provisionFromMeta`)
never fires because the webhook dies first. **Fix:** add `|| criticalSecret('STRIPE_SECRET_KEY')` to
the webhook key read (symmetry with checkout). Trivial + safe.

### 3. Provision failure returns HTTP 200 → forfeits Stripe's retry safety net
`platform-stripe-webhook.js:294-296` returns **200** `no_company_match`, and the outer catch
:341-345 returns **200** on any thrown error. `provisionFromMeta` retries provision only twice inline
(:114). A transient Supabase/auth outage that outlasts those two attempts → 200 tells Stripe
"delivered" → Stripe never re-delivers → the paying customer is permanently stranded (the best-effort
operator SMS at :121-130 is itself try-caught/swallowed). **Fix:** when there IS signup metadata to
provision from and both retries failed (transient), return a **non-2xx** so Stripe re-delivers; keep
200 only for genuinely non-provisionable events (no signup metadata / a real no-match). This turns
the #1 durable "paid but nobody knows" hole into a self-healing retry.

### 4. `session_id` leaks to the Meta Pixel AND is a no-auth bearer credential
`signup.html:14-17` strips only `comp|key|ref` before the Pixel `PageView` fires (:27); it does NOT
strip `billing`/`session_id`, and the return URL is `…?billing=success&session_id={CHECKOUT_SESSION_ID}`
(`platform-billing.js:259`). `platform-signup-verify.js:21-88` accepts **any** valid `cs_...`
session_id with **no other auth** and returns `owner_email` + `owner_password` (reveals the vaulted
pw via `resetpw…once=1`). So the post-payment page ships a credential-yielding capability to Facebook.
**Fix:** add `billing` + `session_id` to the strip list so `replaceState` clears them BEFORE the Pixel
reads `location.href` (mirror the existing comp/ref strip). Residual to flag: session_id is inherently
a browser-held bearer token on the redirect design; the `once=1` idempotent reveal limits blast radius,
but consider not returning the plaintext password from verify on a *repeat* call.

### 5. `platform-payments.js` Stripe-Connect reads use the cold-empty-vulnerable `getSecret`
The criticalSecret coverage audit confirmed the core chain is hardened, but `platform-payments.js:25`
(`stripeKey()`), `:29` + `:30` (`cfg()` URL + service key) all use plain `getSecret` — the **only
unmitigated critical vault gap**. A cold-container empty read silently no-ops a paid shop's Connect
onboarding / payout setup with no error. **Fix:** switch these three to `criticalSecret` (mirror
billing/webhook/provision).

### 6. `setup-bypass.js` demo-hijack is still deployed on 9 seats (one flag-flip from re-firing)
`window.ANT_SETUP_BYPASS = false` today (`config.js:20`) so it's inert — safe as it stands. BUT the
file is still `<script>`-included on all 9 seats (office-board:322, dispatch:207, tech:222,
tech-job:259, owner:172, comms:57, needs-scheduled:91, office-overview:139, returns:85), its hijack
logic is intact, and it does NOT distinguish an anonymous visitor from a real logged-in owner — at
`setup-bypass.js:57-58` any session whose email `!== demo@…` gets **signed out and into the demo
owner**. The config comment (:18-19) explicitly invites flipping the flag back to `true` to re-open
the demo — which would re-clobber every real owner into "Joey's Appliance Repair" (the customer-#1
bug). **Fix (the real go-live gate):** REMOVE the file + its 9 `<script>` includes + the config flag —
don't rely on the flag staying false. (Danielle's no-login demo convenience is the tradeoff — she'd
sign in with the demo login instead; state it.)

## 🟠 HIGH — silent paid-but-can't-login

### 7. Owner login delivery is best-effort AND the operator "success" notify hides the failure
`platform-stripe-webhook.js:163-183`: the magic-link email is best-effort (`emailMode` can be
`dry-run` / `no_email_shared_secret` / `no_login_link` / `error`), and the celebratory operator notify
at :203-213 fires **regardless** and does NOT surface `emailed:false` — so the operator believes it
succeeded while a paying owner has a tenant and no delivered credentials. **Fix:** make the operator
notify carry `emailed`/`email_mode` (the `platform_signup_provisioned` event at :196-201 already does —
mirror it into the human-facing SMS/email so a no-email signup is loud, not silent).

### 8. Webhook-only path never vaults a durable, customer-facing password
If the customer closes the tab before Stripe's redirect (so only the webhook provisions), it mints
only a **magic link** — it never calls `resetpw/reveal`, so no `PLATFORM_OWNER_PW_<slug>` is written
and the temp password lives only in the operator vault/pack (never shown to the customer). Their sole
path in is the magic link; if it expires or SES-sandbox drops it, self-service resend
(`platform-resend-link.js`) is **also email-only** and never returns the link/pw to the browser, and
`owner.html`'s sign-in (:184-199) has no "email me a link" option. Result: **locked out, operator-only
recovery.** **Fix:** on the webhook path (or the fallback "reassure" screen at `signup.html:223`) also
vault a durable password like the redirect path does, so a durable credential always exists and the
`platform_signup_provisioned` event/pack can recover it.

### 9. SES sandbox: `platform-status` reports `login_email: live` while every real customer email is rejected
`send-email.js:36-38` — SES (us-east-2) is in SANDBOX; only `danielle.tnappliance@gmail.com` +
`tnappliancerepair@gmail.com` are verified recipients; `EMAIL_ENABLED` is only the dry-run gate, not a
sandbox exit. `platform-status.js:80-86,114` reports `login_email` green when four secrets exist +
`EMAIL_ENABLED==='true'` — it does NOT know about the sandbox recipient wall. So readiness reads
"live" while every real signup's login email is silently rejected. **Two parts:** (a) **Teddy-gated:**
request SES production access (AWS console us-east-2; root login uses Authy MFA per CLAUDE.md) — the
real fix; (b) **code:** make `platform-status` report `login_email` honestly (e.g. "config set — SES
still in sandbox, real recipients rejected until production access") so the readiness signal isn't
misleading. Findings #7/#8 make this survivable (in-browser cred card is the real backstop), but the
status lie should be corrected.

## 🟡 MEDIUM / LOW (grouped)
- **M1 double welcome email** on the redirect+webhook race — the email send sits OUTSIDE the
  exactly-once dedup block (`webhook.js:163-183` vs the dedup at :188-234). Move it inside / add an
  `event.id` dedup (**M4** — there's no `ev.id` guard anywhere; it's the root enabler of M1+M3).
- **M2 comp path** says "check your email for a sign-in link" (`platform-signup.js:73`) but sends NO
  email and `signup.html:305-311` never renders the returned `temp_password` — if magiclink minting
  fails the founder is stranded. Surface the password on the comp success screen.
- **M3 metadata stamp is best-effort** (`webhook.js:147` try/catch) → a later `customer.subscription.*`
  event can `no_company_match` → plan/status/features never sync (billing drift, not a strand).
- **criticalSecret MEDIUM gaps** (cold-empty degrades a feature, doesn't strand): `webhook.js:169`
  `EMAIL_SHARED_SECRET` (bounded — send-email reads it env-only, so it bites only under a vault-only
  config; harden for consistency), `platform-phone.js:47-48`, `_lib/platform-db.js:24-25`,
  `_lib/usage-meter.js:51-52`, `_lib/tenant-creds.js:24,45-46`.
- **029 invoice writes are role-ungated** (`docs/sql/029_invoice_tech_scope.sql:33-35`) — a tech can
  insert/blind-update invoice rows (incl. totals) in his OWN shop (never cross-tenant). Add an
  owner/office/manager role gate (mirror `041`'s app_user/company gates).
- **L1** four signup failure paths return only `error` with no friendly `message`
  (`platform-signup.js:77,108,109,116`); shielded by client-side validation but violates the
  "every failure has a friendly message" contract — add messages.
- **Out of scope but flagged for Teddy:** TN's OWN repair-customer payment functions read
  `STRIPE_SECRET_KEY` via plain `getSecret` (`create-quickcheck-payment.js:61`, `create-vent-booking.js:30`,
  `refund-payment.js:54`, `pm-setup-card.js:33`, `send-pay-link.js:51`, etc.) — a cold-empty read fails a
  real TN customer's payment link. Not on the SaaS signup chain, but same bug class; his call whether to
  give them the `criticalSecret` treatment too.

## Recommended remediation order (highest leverage first)
1. **#2 webhook key fallback** + **#3 non-2xx on transient provision fail** + **#4 pixel strip** —
   three tiny, high-value edits that close two paid-but-stranded holes + the credential leak.
2. **#1 slug attach-guard** — the cross-tenant catastrophe; surgical (owner-email match on slug reuse).
3. **#5 platform-payments criticalSecret** — the last unmitigated critical vault gap (3-line swap).
4. **#6 remove setup-bypass** (file + 9 includes + flag) — the documented go-live gate.
5. **#7/#8 durable-credential + honest operator notify** — makes login delivery bulletproof regardless
   of SES.
6. Mediums/lows in a cleanup pass; **#9 SES production** is Teddy's AWS action (code half = honest
   status).

## Critical files (for the remediation build, when approved)
- **EDIT:** `platform-signup.js` (#1 attach-guard hook, L1 messages, M2 comp), `platform-provision.js`
  (#1 owner-email-match on slug reuse), `platform-stripe-webhook.js` (#2 key fallback, #3 non-2xx,
  #7 notify carries emailed, #8 vault durable pw, M1/M4 dedup, #5-class EMAIL_SHARED_SECRET),
  `platform-payments.js` (#5 three criticalSecret swaps), `signup.html` (#4 strip billing+session_id),
  `platform-status.js` (#9 honest login_email), `docs/sql/031_invoice_role_gate.sql` (NEW — 029 write
  gate), plus the criticalSecret medium swaps.
- **REMOVE:** `platform/vendor/setup-bypass.js` + its 9 `<script>` includes + `config.js:20` flag (#6).
- **REUSE (no change):** `_lib/secrets.js criticalSecret`, `platform_signup_provisioned` event +
  `action=dashboard`/`magiclink`/`resetpw&reveal` recovery (all already implemented), `credCard()` in
  signup.html (the strong in-browser backstop).
- **PASS — do NOT touch:** the RLS core (`004`/`041`/`029`/`030` tenant scoping — airtight), the empty-
  shop seat rendering + boot shims (clean).

## Verification (when the fixes are built)
- **#1:** provision two synthetic signups with the same shop name + DIFFERENT owner emails → confirm
  two SEPARATE companies (second got a suffixed slug), neither owner sees the other's data.
- **#2/#3:** with only `STRIPE_SECRET_KEY` set, a webhook fires → no longer 500s (falls back); force a
  transient provision failure → webhook returns non-2xx (Stripe would retry); a non-signup event still
  returns 200.
- **#4:** load `signup.html?billing=success&session_id=cs_test` → Network tab shows the Pixel request
  URL carries NO `session_id` (stripped by `replaceState` before the Pixel fires).
- **#5:** `platform-payments?do=diag&probe=1` still green; the three reads resolve via env/criticalSecret.
- **#6:** grep the 9 seats → zero `setup-bypass.js` includes; `config.js` has no `ANT_SETUP_BYPASS`; a
  real login is never signed into the demo tenant.
- **#7/#8:** a webhook-only provision (no redirect) → a durable password is vaulted + the operator
  notify shows `emailed:false`; `resetpw&reveal` recovers it.
- Standard deploy: feature branch `claude/shop-automation-setup-r9wzpm` → ff-merge main → push (4×
  retry/backoff) → Netlify → curl live. Commit trailer per session rules; no model ids in commits. No
  outward/money flag flipped by me (SES production + any flag flips stay Teddy's).

---

# 🚪 DONE (2026-09-09) — KILL invite-only entirely: signup is fully self-serve, always

## Context / why
Teddy: *"I'm not sure how the invite only got on there. That's not even a thing. We need to eliminate
anything that's invite only. I'm putting this platform out there, and it's gonna be a self serve. People
click it, and then they will be able to put in their information and be able to sign up themselves."*
So: remove the invite-only concept completely — no gate, no flag, no "onboarding by invite" copy anywhere.
A shop clicks, enters its info, pays the 14-day trial, and provisions itself. This is SAFE to open fully
right now: the two payment prerequisites are already GREEN + live-verified this session
(`platform-status`: webhook `whsec_ ✓` + `sk_live_ ✓` set, email ready) — so a self-serve paid signup
stands up a real tenant end-to-end (provision-on-redirect + magiclink backstop). The gate today already
computes open-by-default (fail-open), so removing it is not a behavior change for customers — it deletes
the ability to ever close it, and scrubs the stale "by invite" wording.

## The change (small, ~4 files, no new code)
1. **`netlify/functions/platform-signup.js` — remove the gate.** Delete the invite-only block (the
   "BULLETPROOF gate" comment + the `PLATFORM_SIGNUP_LIVE` retry loop + `explicitlyClosed`/`live`/
   `adminBypass` + the `signup_not_open` return, currently ~lines 92-113). Signup then always proceeds
   to the comp path or the card→Stripe-checkout path (both unchanged). `adminBypass` is used ONLY by the
   gate → remove it with the block; `admin` (VAPI_ADMIN_SECRET) + `compAuthed` + the `freshSecret` helper
   stay (comp path still uses them). The `PLATFORM_SIGNUP_LIVE` vault/env flag becomes dead — harmless if
   left; can be deleted from the vault later (cosmetic).
2. **`platform/system.html` (~line 509)** — the prospect fineprint ends "*Onboarding is by invite right
   now — start below and we'll get you set up.*" → change to self-serve wording (e.g. "*Start your free
   trial below — you sign up and you're set up in minutes.*").
3. **`platform/explore.html` (~line 190)** — operator-hub note "*Self-serve signup is invite-only right
   now, so the CTA lands on onboarding-by-invite.*" → "*Self-serve signup is LIVE — a shop starts a free
   trial and provisions itself.*"
4. **`netlify/functions/platform-status.js`** — report signup as plain LIVE self-serve; drop the
   "gated / ready-to-flip / flip on when you want strangers signing up" framing (lines ~65-68, ~108).
   KEEP the two payment-landmine checks (webhook + email) — those are still real go-live prerequisites and
   are already green; they just no longer gate signup.
5. *(cosmetic)* **`platform/signup.html` (lines 313-314)** — update the stale code comment that references
   "the invite-only note / signup_not_open" (no visible change; keeps the code honest). signup.html has no
   visible invite copy.

## Not touched
- The **comp / free-setup** path (`?comp=` + `PLATFORM_COMP_TOKEN`) is a separate no-card founder path, not
  "invite-only" for the public — leave it.
- `vapi-admin.js` "invite" = call-silence phrasing (unrelated). The `invItems` hits in tech-job.html are
  invoice line-items (unrelated).
- Standing money-safety note (NOT a gate): there is now NO way to pause new signups. If Teddy ever wants a
  break-glass "maintenance pause" (a temporary state that never says "invite"), that's a separate small
  add — flag it, don't build it now.

## Verification
- After deploy: a bogus/comp signup POST to `platform-signup` can NEVER return `signup_not_open` (the code
  path is gone); a real card walk reaches Stripe checkout with no gate.
- `curl` system.html + explore.html → zero "invite" text; `platform-status?secret=` → signup shown LIVE
  self-serve, no "flip" language, the two payment landmines still green.
- Standard deploy: feature branch `claude/shop-automation-setup-r9wzpm` → `git checkout main && git merge
  --ff-only` → push both (4× retry/backoff) → Netlify → curl live. Commit trailer per session rules; no
  model ids in commits. No outward/money flag flipped (removing a false-negative gate; payment plumbing
  already live + verified).

---

# 🐞 DONE (2026-09-09) — FIX the "We're onboarding by invite" false-reject on a live signup (cold-container vault flake)

## Context / the bug Teddy caught
Testing the real-card signup, Teddy screenshotted the form showing the red **"We're onboarding shops by
invite right now — leave your email and we'll reach out"** message sitting under a live "Start my 14-day
trial" button. That's not a rendering bug — `signup.html:313-315` faithfully renders `d.message` from the
server. The SERVER intermittently returns `signup_not_open` **even though signup is live**. Reproduced
live this turn with a 6× rapid burst against `platform-signup`: tries 1-2 → `signup_not_open`, tries 3-6 →
gate passed (`terms_required`). So a tester tapping the trial button on a cold Netlify container gets
falsely bounced to "invite-only," and a retry a moment later works. Not flawless.

**Root cause (confirmed by code read):** `netlify/functions/platform-signup.js` reads the gate flags with
the CACHED `getSecret` — `line 89 getSecret('PLATFORM_SIGNUP_LIVE')` and `line 78
getSecret('PLATFORM_COMP_TOKEN')`. Per the documented vault flake, `getSecret` **caches the empty read on a
cold container**, so `live` computes false → `signup_not_open`. The sibling `platform-status.js` already
fixed this exact trap (lines 8-12): it imports `getSecretFresh` and reads flags via
`freshSecret = (n) => process.env[n] || getSecretFresh(n)` (env-first, then a fresh vault read that bypasses
the empty cache) — which is why platform-status reliably reports `signup_open:true` while the real gate
flakes. (`VAPI_ADMIN_SECRET` at line 77 is fine as-is — it has a hardcoded fallback, so a cold-empty read is
harmless.)

## The fix (one file, mirrors the proven platform-status pattern)
`netlify/functions/platform-signup.js`:
1. Import fresh: `line 11` → `const { getSecret, getSecretFresh } = require('./_lib/secrets');`
2. Add the helper (copy `platform-status.js:12`): `const freshSecret = async (n) => process.env[n] || (await getSecretFresh(n));`
3. `line 89` `PLATFORM_SIGNUP_LIVE` → read via `freshSecret('PLATFORM_SIGNUP_LIVE')`.
4. `line 78` `PLATFORM_COMP_TOKEN` → read via `freshSecret('PLATFORM_COMP_TOKEN')` (same flake would falsely
   reject a valid comp link too).
Leave the admin-secret read on `getSecret` (fallback covers it). No other file changes; signup.html already
renders the message correctly.

## Verification
- After deploy, re-run the 6× rapid burst POST to `platform-signup` with `{comp:true,comp_token:"bogus",…}`
  → it must **never** return `signup_not_open` (consistently `terms_required` / `comp_not_authorized` now
  that `live` reads true on every container, warm or cold).
- Teddy re-loads a fresh signup link on a cold load, taps "Start my 14-day trial" → goes straight to the
  Stripe card screen, no invite message.
- Standard deploy: branch `claude/shop-automation-setup-r9wzpm` → `git checkout main && git merge --ff-only`
  → push both (4× retry/backoff) → Netlify (~1-2 min) → curl the burst live. Commit trailer per session
  rules; no model ids in the commit. No outward/money flag flipped (this only fixes a false-negative gate
  read; the flag stays exactly as Teddy set it).

---

# 🧪 ACTIVE (2026-09-09) — 2-3 REAL-CARD signup tests to get the flow flawless (Teddy: "Real card only")

## Context
Teddy wants to run 2-3 more full end-to-end signup tests to make the signup + handoff + crew flow
"absolutely flawless," and asked for links he can just tap/send. He chose (AskUserQuestion): **REAL card
only** — every test hits the exact paying-customer path. This is zero-setup: signup is already LIVE and
every landmine is green (verified read-only this turn): `signup_open:true`, `stripe_mode:live`, webhook
`whsec_ ✓ + sk_live_ ✓ set`, `login_email.ready:true`, and provision-on-redirect + the in-browser
login card mean a paid test **can't strand him** (he lands in the dashboard with link/login/password
shown, email not even required; magiclink backstops it). No code to build — the whole flow already exists.

## The links (real-card, ready to send — `?v=` just themes + preselects the trade; he can flip the Trade dropdown to anything)
1. `https://tnapplianceexchange.net/platform/signup.html?v=appliance`
2. `https://tnapplianceexchange.net/platform/signup.html?v=dryer-vent`
3. `https://tnapplianceexchange.net/platform/signup.html?v=auto-repair`
(Bare `…/platform/signup.html` works identically. Vertical keys available: appliance, dryer-vent,
auto-repair, furniture, dealership, aquarium.)

## The two hard rules for each test (state loudly to Teddy)
- **FRESH email every run** — NOT `tnappliance@gmail.com` / `tnappliancerepair@gmail.com` (those already own
  shops → an email collision makes a loginless shop, the exact bug that bit the old "test shop").
- Card → 14-day trial = **$0 charged now** (creates a *trialing* Stripe subscription I cancel after).

## What Teddy walks each time (the flawless-check surface)
signup form → pays → **success card shows the dashboard link + login email + password + "Copy my login"**
(refresh-proof) → **"Open my dashboard →"** → owner.html → **"Your team logins"** card lists owner + 2 office
+ 4 tech logins → optionally tap **Add a crew member** (Tech/Office) → sign into a tech/office seat to confirm
it lands scoped to that new shop. He reports anything that isn't flawless; I fix + redeploy same day.

## Cleanup after each test (the "execution" — needs Teddy's go; done as tests come in)
For each test shop (I capture the slug from `platform-provision?action=tenants` + the email Teddy used):
1. **Cancel the trial:** `platform-subs-audit?action=cancel&secret=<admin>&email=<test email>&confirm=yes`
   (or `&sub=<id>`). Verify with `action=list` that no leftover test trial remains.
2. **Purge the tenant:** `platform-provision?action=offboard&slug=<slug>&secret=<admin>` (soft, revokes logins)
   then `…&action=purge&slug=<slug>&confirm=yes&force=yes` (hard delete; if `SUPABASE_MGMT_TOKEN` isn't
   vaulted the logins are still deleted + shop churned, and the empty rows self-clean via the 30-day sweep —
   same zero-residue outcome as the ATN/Alyse/Jimmy test purges). ⚠️ NEVER purge the two real shops
   `tn-appliance-exchange-llc` (keeper) or `tn-appliance` (flagship-guarded); the purge guard refuses the
   flagship, and I only ever pass a fresh test slug.
3. Confirm gone: `action=tenants` no longer lists the test shop.

## Verification
- Each test: Teddy lands in the owner dashboard with the login card + team-logins card populated; nothing
  stranded. Any rough edge → I fix + redeploy (branch → ff-merge main → push w/ retry → Netlify → curl).
- After cleanup: `platform-subs-audit?action=list` shows no leftover test trials; `action=tenants` shows the
  test shops gone; the two real TN shops untouched.

---

# 🧪 (superseded by real-card above) Let Alyse walk a FULL new-signup with payment skipped (comp path)

## Context
Teddy wants his wife Alyse to take the whole new-signup path with the **payment part skipped** (or pay +
cancel after). The platform already has exactly this built-in: the **COMP path** in `platform-signup.js`
(`provisionComp`) runs the entire signup form but **skips Stripe completely**, provisions a live tenant, and
returns a one-tap login link that drops the owner straight into their dashboard. `signup.html` already
supports it (`?comp=<token>` is captured + stripped before the Meta Pixel, then sent as `comp_token` in the
POST; the button flips to **"Set up my shop — free →"** and the note reads "no card needed"). It's gated by a
low-privilege `PLATFORM_COMP_TOKEN` that just needs to be vaulted once. Because it returns the login link
in-browser, SES sandbox doesn't matter — she lands in the dashboard directly.

## Recommended — comp / skip-payment (cleanest: no card, nothing to cancel)
1. **Teddy vaults** `PLATFORM_COMP_TOKEN = comp_90078c7fe870a5a13003` in `admin-secrets.html` (~30s). (Bonus:
   this also enables free "comp / founder" signups for you or a comped shop going forward.)
2. I verify comp is live (a bad-token comp POST returns `comp_not_authorized` = token IS vaulted; a real one
   provisions) — post-approval.
3. **Hand Alyse:** `tnapplianceexchange.net/platform/signup.html?comp=comp_90078c7fe870a5a13003&v=dryer-vent`
   - ⚠️ She MUST use a **FRESH email** (NOT `tnappliance@gmail.com` — that already owns the real shop →
     email collision → loginless shop, exactly what bit the earlier "test shop"). Any shop name; she can
     switch the Trade dropdown off dryer-vent to anything.
   - She fills it out → **"Set up my shop — free →"** → **no payment** → lands straight in the owner dashboard.
4. **Cleanup after:** I offboard + purge her test tenant (same as I did for `test-shop`), zero residue.

## DECIDED (2026-09-09) — pay-and-cancel, APPLIANCE trade (Teddy: "no vault, on the road" + "need it for appliance not dryer vent")
Alyse walks the full live signup at **`signup.html?v=appliance`** with a **fresh email + a real card** →
14-day trial (**$0 charged now**) → provision-on-redirect logs her straight into the owner dashboard (SES
sandbox irrelevant — the login link comes back in-browser). When she's done, I cancel her trialing
subscription via the now-built **`platform-subs-audit?action=cancel&email=<her email>&confirm=yes`** and purge
her test tenant (`platform-provision offboard`+`purge`). No vault, no comp token needed.
- ✅ Stripe cleanup already done this session: `platform-subs-audit` built + deployed; the 3 dead test-shop
  trials (test-shop, tn-appliance-repair, atn-appliance-exchange-llc) CANCELED; only the real shop
  `tn-appliance-exchange-llc` trial remains (bills $99/mo on 9/17 — Teddy's decision whether to keep/comp).

## Fallback — pay-and-cancel (zero setup for Teddy, but leaves a Stripe sub to clean)
Alyse uses the normal live link `signup.html?v=dryer-vent` with a **fresh email + a real card** → 14-day trial
(**$0 charged now**) → creates a real *trialing* Stripe subscription → I cancel it afterward (either build a
small admin-gated Stripe checker/canceler, or Teddy cancels in Stripe Dashboard → Subscriptions) + purge the
tenant. No vaulting needed, but it does create a Stripe subscription we must remember to cancel.

## Critical files (reference — comp path needs NO code edits, it's already built)
- `netlify/functions/platform-signup.js` (`provisionComp` — the no-Stripe path), `platform/signup.html`
  (comp handling, already wired), `netlify/functions/platform-provision.js` (`offboard`/`purge` for cleanup).
- Only the **fallback** would need a small net-new Stripe read/cancel function (there's no subscription
  list/cancel action in `platform-billing.js` today).

## Verification
After Teddy vaults the token: open the comp link → button reads "Set up my shop — free" + "no card needed";
a real submit (fresh email) returns `{ok:true, login_url}` and lands in the dashboard; then purge the test
tenant + confirm it's gone from `action=tenants`. No deploy for the comp path.

---

# 🔑 ACTIVE (2026-09-09) — Get Teddy into his dashboard (no login email arrived) + fix the SES-sandbox gap

## What actually happened (diagnosed LIVE, read-only, this turn)
Teddy did a "signup" walk, saw "You're all set! Check your email for a link to sign into your
dashboard," but no email came. Live tenant list (`action=tenants`) settles it:
- **His real shop ALREADY EXISTS: `tn-appliance-exchange-llc`** (TN Appliance Exchange LLC, **3,422
  jobs**, status active), owner login **`tnappliance@gmail.com`** + full crew (jimmy/andre/lee/john techs
  + danielle/sofia/carrie office). **No fresh tenant was created today** — `platform-status` shows
  `signup_open:false` + Stripe `stripe_mode:"not_configured"` (no `PLATFORM_STRIPE_SECRET_KEY`/webhook),
  so the paid card path CAN'T complete a signup, and indeed no new slug appears (the old throwaway
  `tn-appliance-repair` is already purged; `tn-appliance` = the churned legacy 968-job shell). So the
  "You're all set" screen did NOT stand up a new shop — his shop is the keeper he already owns.
- **No login email, and he doesn't need one.** Root cause = SES (us-east-2) is in **SANDBOX**:
  `send-email.js` (lines 36–38) documents the ONLY verified recipients as `tnappliancerepair@gmail.com`
  + `danielle.tnappliance@gmail.com`. His signup email `tnappliance@gmail.com` is NOT verified → SES
  rejects it, and the send is best-effort/swallowed (comp path doesn't even send one; the webhook path
  swallows the SES error) → the shop provisions but the email silently never lands. `login_email.ready:
  true` in platform-status only means the CONFIG is set (secret/enabled/creds) — it can't see the SES
  sandbox recipient block.

## Get him in RIGHT NOW — the pre-committed magic-link fix (no email needed) → on approval
- `platform-provision?action=magiclink&slug=tn-appliance-exchange-llc&secret=<admin>` → returns a
  `login_link` (Supabase admin `generate_link`, INDEPENDENT of SES — it MINTS the URL, doesn't email it),
  landing on his dashboard. Hand Teddy the one-tap URL. One tap, no typing, no email. (magiclink code:
  `platform-provision.js:146-163`, resolves the owner email from the slug.)
- **Backup (durable):** his owner login is `tnappliance@gmail.com` / password `Ant-nl81uh10` (set
  2026-09-03). Magic links are single-use + ~1hr, so also hand him the password as the durable way back
  in; if stale → `action=resetpw&slug=tn-appliance-exchange-llc&reveal=1&secret=<admin>` for a fresh one.
- Verify before handing over: magiclink response `ok:true` + non-empty `login_link`; optionally confirm
  the password authenticates via `signInWithPassword` against the platform anon key.

## Fix the email for FUTURE signups (Teddy/AWS action — documented, NOT blocking his access)
The login-email chain is config-correct but capped by SES sandbox: it delivers ONLY to the two verified
addresses above, so any real self-serve customer's email (and Teddy's own secondary) is silently
rejected today. Before self-serve signup goes live to strangers, SES must either (1) **move OUT of
sandbox** — request production access in the AWS SES console (us-east-2; AWS root login uses Authy MFA on
Teddy's phone per CLAUDE.md) — the real fix that delivers to any address; OR (2) verify each recipient in
sandbox (fine to add `tnappliance@gmail.com` so his own emails land, but doesn't scale to customers).
Recommend #1 before flipping `PLATFORM_SIGNUP_LIVE`. Until then, `magiclink`/`resetpw` is the reliable
onboarding path — "no signup is ever stranded," exactly the backstop platform-status advertises.

## Verification
- `action=tenants` (done, read-only): `tn-appliance-exchange-llc` active, 3,422 jobs, `tnappliance@gmail.com`
  owner — no fresh duplicate. On approval: `action=magiclink&slug=tn-appliance-exchange-llc` returns a
  working `login_link` → hand it to Teddy → he taps → lands on his dashboard with his real book. Pure
  recovery: no code change, no deploy, no money/outward flag flipped.

---

# 📋 ACTIVE (2026-09-08) — Xano→platform PARITY punch-list; first item: PARTS-RETURN TRACKING (the chargeback killer)

## Context / why
The new Supabase platform is the better system overall, and TN is preparing to go **full-time** on it (off
the legacy Xano/HCP system). Before the cutover, Teddy wants a **parity punch-list**: the handful of things
the old Xano system does that TN loves, mapped to how each gets carried over to the platform. This is a
living list — we work it item by item. Teddy's **first pick = PARTS-RETURN TRACKING** (the chargeback killer:
every warranty part owed back to a distributor, RMA/FedEx label matched, one-tap "Returned"). Losing an
un-returned part = lost pay + a core charge, so this is real money protection, not nice-to-have.

Teddy's specific pain + ask (2026-09-08): SquareTrade/Allstate ship a **pile of parts** per job and TN has a
lot of returns that are hard to manage. He wants to **simplify**: a "parts to return" section where the tech
just **taps the camera, snaps a few pictures of every part they did NOT use, and brings them back** — and the
system **reads the part number off the photo (OCR)** and logs the return automatically. No typing. This
mirrors the model-sticker photo→OCR flow TN had before.

## What already exists on the platform → REUSE (don't rebuild)
Exploration (2026-09-08) found the platform is further along than expected:
- **`job_part` table** already has `disposition` (CHECK `used|return|not_here`), `number`, `name`, `source`,
  `ship_to`, `eta`, `cost_cents`, `sell_cents`, `photo_ref`, `company_id`, `job_id`, `xano_id`. RLS lets any
  authenticated in-company user (tech OR office) read/write; service key bypasses for tees. (`019_job_part.sql`
  base; `034`/`038` widen; `source/ship_to/eta` added by `platform-migrate.js`; `055_job_part_xano_id.sql`.)
- **Tech disposition writer already live** in `platform/tech-job.html` "🔩 PARTS TRACKER": per-part Used /
  Unused(return) / Not-here buttons + photo proof + a per-job "🔁 N to ship back or the shop eats a chargeback"
  banner. Office has a "🔩 Parts" editor in `office-board.html` (number/name/source/ship_to/eta).
- **Warranty parts auto-flow in** from Xano every 15 min: `platform-tn-parts-migrate.js` (+ cron `13-59/15`)
  lands `warranty_part_supplied` + `parts_orders` → `job_part`, mapping `requires_return`/`to_return` →
  `disposition='return'`. So SquareTrade parts flagged for return already land as "owed back."
- **Platform Vision OCR exists**: `platform-ocr.js` (tenant-clean, `claude-sonnet-5`, input `{data}` base64 OR
  `{url}`, returns model/serial/brand). The legacy `ocr-model-extract.js` already has a **`part_sticker`
  bucket** returning `{part_number, part_description, manufacturer, confidence}` — lift that prompt.
- **Tech photo→R2 pipeline**: `platform-tech-media.js do=photo` (tech `access_token` → R2 via `_lib/r2.js`
  → `job_media {kind:photo, provider:r2, ref}` → returns signed url). `r2.presignGet(ref)` bridges a stored
  photo to the OCR `{url}` input. `platform-media-urls.js` signs refs for office thumbnails.
- TN's platform tenant: company **`be4d11a1-5219-469b-916a-ab990be7ea7f`** / slug **`tn-appliance-exchange-llc`**.

## What's MISSING = the carry-over build (v1, ordered by leverage)

### 1. Migration `docs/sql/056_part_return.sql` — the terminal "shipped back" state
Today `disposition='return'` has no close-loop, so a returned part stays flagged forever. Add to `job_part`:
- `returned_at timestamptz` (null = still owed back; set = shipped/closed → drops off the worklist)
- `returned_by text` (tech/office attribution)
- Phase-2 RMA-lane homes (nullable, unused in v1): `rma_number text`, `return_tracking text`, `return_carrier text`.
No RLS change (job_part RLS already correct). Apply live via `sb-admin-sql?project=platform`. Next number = 056.

### 2. Add a `part_sticker` bucket to `platform-ocr.js`
Lift the part-sticker classification + prompt rules straight from `ocr-model-extract.js` (bucket 2). Return
`{ok, kind:'part'|'model'|'none', part_number, part_description, manufacturer, confidence, ...model fields}`.
Input unchanged (`{data}`/`{url}`). Small, contained; the existing model-sticker path is untouched.

### 3. Tech camera-first "Return a part" flow (the simplification Teddy asked for)
A new server action **`platform-tech-media.js do=return_part`** (one round-trip, service-key, OCR key stays
server-side): takes `{job, access_token, data(base64 photo)}` → uploads to R2 + `job_media` (label
`'Warranty return part'`) → OCRs the photo via `platform-ocr` part bucket → **inserts (or merges) a `job_part`
row** `{company_id, job_id, number:<OCR part#>, name:<OCR desc or 'Unused part'>, disposition:'return',
source:<job.warranty_company>, photo_ref:<ref>}`. Dedup: if the OCR'd part# normalizes (uppercase, strip
non-alphanumerics — the legacy `normP` idea) to an EXISTING `job_part.number` on that job, UPDATE that row to
`disposition='return'` + attach the photo instead of creating a duplicate. Returns the created/updated row so
the tech sees the read-back part# and can correct it. **Robustness: if OCR fails / low confidence, still
create the return with the photo + a blank/"needs part #" — the photo IS the record; nothing is ever lost.**
- UI in `platform/tech-job.html`: a prominent **"📸 Snap unused parts to return"** button in the parts area
  (surfaced esp. on warranty jobs), reusing the existing `<input type=file accept="image/*" capture="environment">`
  + canvas-downscale pattern from `runOcr`. Tech can fire it repeatedly — each snap = one return row with its
  photo. Show a running "N parts flagged to return on this job" so they can snap the whole pile fast.

### 4. Office cross-job returns worklist — new `platform/returns.html` (the main gap)
A new office seat modeled on `office-board.html` (copy its head/auth/`applySkin`/hop-nav pattern; Supabase
session-gated, RLS auto-scopes to the shop). Reads `job_part` where `disposition='return' AND returned_at IS
NULL` across the company, grouped by job/claim/customer, oldest-first. Each row: part# + name + **photo
thumbnail** (via `platform-media-urls` presign of `photo_ref`) + customer + age + distributor/source + a
**"✓ Shipped back"** button that sets `returned_at=now()` + `returned_by` (browser `sb.from('job_part')
.update(...)`, RLS-safe) so it drops off the list. A small scoreboard up top (N owed / N shipped this period /
oldest). Add a **"📦 Returns"** pill to the office `hop` nav on office-board.html/dispatch.html.

### Phase 2 (FLAG — Teddy's call, NOT v1): SquareTrade RMA-label email tee
Model on `platform-warranty-tee.js`: a Gmail cron reading `rma_request@squaretrade.com` return-label emails,
parsing RMA#/tracking/distributor/part#/claim (port the legacy `squaretrade-rma-watch.js` parser), matching
to the platform job by claim (the parts-migrate `resolveJobByClaim` helper) → fills the v1 RMA columns
(`rma_number`/`return_tracking`/`return_carrier` + the label ref) on the matching return row. This adds the
prepaid-label + proof-of-delivery automation the legacy system has. Deferred: the camera flow + worklist +
close-loop deliver the organization value first; the RMA tee is the automation layer on top.

## Critical files
- **NEW:** `docs/sql/056_part_return.sql` (returned_at/returned_by + RMA columns); `platform/returns.html`
  (office worklist).
- **EDIT:** `platform-ocr.js` (add `part_sticker` bucket, lifted from `ocr-model-extract.js`);
  `platform-tech-media.js` (new `do=return_part` = upload+OCR+insert/merge); `platform/tech-job.html`
  (📸 Snap-unused-parts button + running count); `platform/office-board.html` + `platform/dispatch.html`
  (📦 Returns hop pill).
- **REUSE (no change):** `_lib/r2.js` (`put`/`presignGet`), `platform-media-urls.js` (thumbnail signing),
  the `job_part` model + RLS, the parts-migrate `disposition` mapping (SquareTrade parts already land as
  `return`), the `platform-tech-media do=photo` + `runOcr` canvas-downscale patterns, `office-board.html`
  head/auth/skin + hop nav.

## Verification
- Migration: apply 056 live; `select column_name from information_schema.columns where table_name='job_part'`
  shows `returned_at`/`returned_by`.
- OCR: `curl platform-ocr` with a part-sticker photo (`{data}` base64) → returns `kind:'part'` + a `part_number`.
- Tech flow: on a demo warranty job, tap "Snap unused parts", take a photo of a part/box → a `job_part`
  `disposition='return'` row appears with the OCR'd part# + the photo; a second snap of a part # already on
  the job MERGES (no dup); an unreadable photo still creates a return with the photo + blank #.
- Office worklist: `platform/returns.html` (office login) lists that return with its thumbnail, oldest-first;
  "✓ Shipped back" sets `returned_at` and it drops off; the per-job tech banner still shows the live owed count.
- RLS/isolation: a return on TN's tenant is invisible to any other tenant (folder-prefix + `company_id` scope).
- Standard deploy: feature branch `claude/shop-automation-setup-r9wzpm` → `git checkout main && git merge
  --ff-only <branch>` → push both (4× retry/backoff) → Netlify → curl the new page + function 200. Commit
  trailer per session rules; no model ids in commits. No outward/money flags.

## Then → next parity item
After parts-return ships, revisit the punch-list with Teddy: warranty claim auto-file, parts finder + live
Marcone pricing, troubleshooting brain / rich TDR — one at a time.

---

# ▶ (superseded — packs done) Test the login: build ONE demo pack shop + hand Teddy the 7 logins

## Context / why
The shop-login-pack system is built, deployed, and verified (shoppack + addseat + packs.html +
onboard-shop crew step — all live, all tested). Teddy now wants to actually SIGN IN and poke around.
Fastest, safest test = a purpose-built demo shop he owns for testing (never a real shop's data): one
`shoppack` call mints owner + 2 office + 4 techs with memorable revealed passwords + seeds one sample
job so the board isn't blank, then hand him the full credential sheet + the three login URLs so he can
sign into every seat and confirm each one lands on the right screen scoped to that one shop.

## The build (one command + a hand-off, ~1 min)
1. **Mint the test shop** (operator, no plan-file blockers once approved):
   `platform-provision?action=shoppack&secret=<admin>&name=Ant%20Test%20Shop&office=2&techs=4&seed=1`
   → returns 7 seats: owner (owner.ant-test-shop@assistant247.net) · Office 1-2 · Tech 1-4, each with a
   `Ant-AntTest<n>` password, + `booking_link` (/b/ant-test-shop) + `intake_email`. `&seed=1` drops one
   sample job so the board + tech "My Day" aren't empty.
2. **Verify all 7 authenticate** (signInWithPassword against the platform anon key) before handing them over
   — so Teddy never hits a bad credential on his first try.
3. **Hand Teddy the sheet** — role · email · password · which URL to open:
   - Owner   → `tnapplianceexchange.net/platform/owner.html`
   - Office  → `tnapplianceexchange.net/platform/office-board.html`
   - Tech    → `tnapplianceexchange.net/platform/tech.html`
   Plus: he can open `tnapplianceexchange.net/packs` with his ops key to see this shop's pack + tap
   **➕ Add a tech** to watch a brand-new tech login appear live.
4. **Leave it standing** so he can test at his own pace; when he's done, one `offboard` + `purge` cleans it
   to zero residue (same as the verify throwaways).

## Critical files / tools (all REUSE — nothing new to build)
- `platform-provision.js` action=shoppack (mint) / action=addseat (his ➕ Add-a-tech test) / offboard+purge (cleanup).
- Seat pages: `platform/owner.html`, `platform/office-board.html`, `platform/tech.html` (RLS-scoped by login).
- `platform/packs.html` (`/packs`, ops-key gated) — the operator view + Add-a-tech button.

## Verification
- The `shoppack` response shows 7 seats; each email+password returns a token from the platform auth endpoint;
  signing into owner.html shows "Ant Test Shop" (not demo/Joey's), office-board shows the seeded job, a tech
  login shows only its own "My Day". `➕ Add a tech` on /packs mints an 8th login that also authenticates.

---

# 🔑 (done, verified) SHOP LOGIN PACKS: one command → a full 7-seat shop + a copy-paste credential sheet

## Context / why
Teddy wants a stack of ready-to-go Ant systems so that as shops come in he can instantly hand each person
their own login + the link they open — no gathering emails, no waiting. He'll pre-build ~5-6 now and grab
one as a real shop arrives. Decisions (AskUserQuestion): **system-assigned login emails** (so nobody's real
email is needed up front) and **7 seats per shop** (owner + 2 office + 4 techs). The key simplification: the
LINKS are the same for everyone in a role (owner→owner.html, office→office-board.html, tech→tech.html); only
the LOGIN (email + password) is per-person. So a shop's "welcome pack" = a short sheet of role · email ·
password · link that Teddy copies a line at a time and texts out.

Recon (Explore, this session) confirmed what to reuse + the gaps:
- **REUSE:** `platform-provision.js` `action=provision` (company + owner login, returns `temp_password`),
  `action=addtech` (tech login + technician row), `action=resetpw&reveal=1` (returns plaintext + vault-stores
  `PLATFORM_OWNER_PW_<slug>`), `action=magiclink` (logs the operator in AS a shop — the god-view), the service-key
  `platform()` client, `_lib/secrets` vault, and `dashboard.html` (ops-key gate + "Jump in" pattern).
- **GAPS to close:** (1) `addtech` mints role='tech' only — there's NO office-role path (the TN office logins were
  made by addtech + a manual `update app_user set role='office'` via sb-admin-sql); (2) office/tech temp passwords
  are VAULTED, not returned — a pack needs them REVEALED; (3) no single call makes a whole 7-seat shop; (4) no
  page shows the packs for copy-paste later.

## The build
### 1. `platform-provision.js` — new admin action `shoppack`
Input: `name`, `slug` (auto-derived + uniqued, reuse the existing slug logic), `office` (default 2), `techs`
(default 4), optional `seed`, `secret` (admin/operator-gated like the other actions). It:
- Provisions the company + owner (reuse the internal `provision` path).
- Mints `office` office logins (**role='office'**) + `techs` tech logins (role='tech', each linked to a
  `technician` row), each with a **memorable password** (`Ant-<slug><n>` style) set + **returned in the response**.
- Login-email convention matching the existing crew style (`jimmy.tnae@assistant247.net`): **`owner.<slug>@assistant247.net`,
  `office1.<slug>@…`, `office2.<slug>@…`, `tech1.<slug>@…` … `tech4.<slug>@…`** — pure identifiers (no email is
  ever sent to them; the person just types email+password), so nothing waits on anyone.
- **Office-role fix:** give `addtech` (or a shared internal) a `role` param so it can create role='office' seats
  directly (set `app_user.role='office'` + DON'T create a technician row for office seats) — closes gap #1 cleanly
  in code instead of the manual SQL patch.
- **Persist the pack** to the vault as `PLATFORM_PACK_<slug>` (JSON: shop name/slug + the 7 seats {role,label,email,
  password,link} + the public booking link `/b/<slug>` + warranty-intake email `<slug>@jobs.assistant247.net`), so
  `packs.html` can re-show it later without resetting anyone's password. (Consistent with resetpw already
  vault-storing `PLATFORM_OWNER_PW_<slug>` plaintext — same established pattern, ops-gated read.)
- **Idempotent by slug:** re-running reuses the company + only mints any missing seats (never duplicates).
- Returns the full structured pack in the response.

### 2. `platform/packs.html` — operator credential-pack page (ops-key gated, mirror `dashboard.html`)
- Lists every built shop (reads `action=tenants` + each `PLATFORM_PACK_<slug>` via a small `action=packs` read on
  platform-provision, operator-gated). Per shop, a card with the 7-seat table: **role · label · email · password ·
  🔗 open-link**, plus:
  - **Copy buttons:** "Copy this person" (one clean line: `Owner login — email / password → <link>`) and "Copy the
    whole shop" (the full pack as pasteable text to drop in a message).
  - **🔑 Jump in as owner** (reuse `action=magiclink`) so Teddy can preview any shop as its owner across every seat.
  - **➕ New shop pack** button at top → calls `shoppack` with a name he types → the card appears ready to hand out.
- Same head/boot/ops-gate as dashboard.html; theme-aware; phone-friendly (he hands these out from his phone).

### 3. Pre-build 5-6 shops
Run `shoppack` 5-6 times (generic placeholder names like "Ant Shop 01"…"06", renamable to the real shop later via
a one-field company.name update). Verify each of the 7 logins authenticates. Per the earlier "both" decision, a
richer realistic demo BOOK for the seeded ones is a fast-follow (needs the seed-schema recon still in flight) — v1
ships the logins + links + optional `&seed=1` single sample job so a shop isn't blank.

## Honest notes for Teddy
- Passwords in the packs are **initial hand-out credentials** — the person logs in and can change theirs after
  (the pack still shows the original until they do; that's fine for handing out).
- `packs.html` is **operator-gated** (the same ops key as dashboard/ops) — it shows plaintext handout passwords, so
  it's an operator tool, never customer-facing.
- Renaming a placeholder shop to a real shop's name = a one-field update (I'll add a rename to the pack action or do
  it inline); the logins/links stay the same, so a pack handed out still works after rename.

## Critical files
- **EDIT:** `netlify/functions/platform-provision.js` — new `shoppack` + `packs` read actions; add a `role` param to
  the tech-creation path so office seats get role='office'. Reuse provision/addtech/resetpw internals + `platform()` +
  `_lib/secrets` (setSecret/getSecret) + the slug logic.
- **NEW:** `platform/packs.html` — the operator credential-pack page (mirror `dashboard.html` gate + card pattern +
  the magiclink "Jump in" call).
- **REUSE (no change):** `action=magiclink` (god-view), `action=tenants`, `dashboard.html` (pattern), the seat pages
  (owner/office-board/tech — RLS-scoped by login, unchanged), `/b/<slug>` booking link.

## Verification
- `shoppack?secret=<admin>&name=Ant%20Shop%2001&office=2&techs=4` → returns 7 seats with emails/passwords/links; the
  company + 7 `app_user` rows exist (1 owner, 2 office, 4 tech) with correct roles; 4 `technician` rows (techs only).
- Each of the 7 emails+passwords authenticates against the platform anon key (`signInWithPassword`), and lands on the
  right seat (owner→owner.html, office→office-board, tech→tech.html My Day) scoped to that shop.
- `packs.html` (ops key) lists the shop, the copy-one-line + copy-whole-shop buttons produce clean pasteable text,
  and "Jump in as owner" opens the shop as its owner.
- Idempotent: re-running `shoppack` on the same slug mints 0 new seats.
- Deploy standard: branch `claude/shop-automation-setup-r9wzpm` → ff-merge main → push (retry/backoff) → Netlify →
  curl the fn + page 200. Commit trailer per rules; no model ids in commits. No outward/money flags (these are logins,
  not spend).

---

# 📊 ACTIVE (2026-09-08) — TK's KPI dashboard: it already exists (owner.html) — add the one missing tile (avg ticket) + flag the review gap

## Context / why
Teddy texted TK "what KPIs do you want to see on your new Ant system?" (jobs done, revenue, avg ticket,
first-time-fix, callbacks, tech performance, review count). TK's replying "let's chat." Recon (Explore,
this session) confirms the shop-owner KPI dashboard **already exists and is near-complete** — it's
`platform/owner.html`, rendered client-side from RLS-scoped Supabase queries (no dedicated endpoint), and it
already computes **5 of the 6** KPIs Teddy listed: jobs done (Completed tile `:398`), revenue/collected
(Money block `:425-436`), first-time-fix (First-Stop tile `:395`, `:276-278`), callbacks (tile `:396`,
`:268-273`), per-tech performance (table `:349-369`), plus goals/take-home, tech pay, Ann accuracy. It's a
SHARED template — TN (customer #1) and TK's future tenant both get it via login, RLS-scoped, no per-shop code.

**Two gaps vs the exact list Teddy promised TK:**
1. **Avg ticket** — NOT rendered as a tile, but every input is already fetched in `load()` (`billed`/`collected`
   `:282` ÷ `completed.length` `:263`). Trivial, high-value, on TK's list → add it.
2. **Review count / velocity** — ❌ genuinely not on the platform. No review/rating table exists in
   `docs/sql/`; `platform-review-sweep.js` only SENDS "leave us a review" texts, stores no ratings; owner.html's
   rating goal explicitly says "connect your Google reviews." So reviews are Google-only → a real net-new
   ingestion (Google Business Profile API or manual entry) before it's a KPI. **Deferred + flagged, not built now.**

## The change (small, one file, shared template → helps TN + TK)
Add an **"Avg ticket"** tile to `platform/owner.html`'s `render()`:
- Compute synchronously from vars already in scope: `avgTicket = completed.length ? Math.round(collected /
  completed.length) : 0` (or use `billed` — match whichever the Money block leads with; `collected` is the
  honest "money actually in" number). Guard the zero-completed case → show `—`, never `NaN`.
- Render it in the existing KPI tile row beside Completed / First-Stop / Callbacks (`:395-398`) using the
  existing `tile()` (`:1020`) + `USD()` (`:178`) helpers — same idiom as the surrounding tiles. Respect the
  same feature gate (`:371-388`) so a no-database shop still doesn't see the money body.
- Window-aware for free (it rides the existing week/month/YTD selector via `completed`/`collected`).

## Optional (FLAG for Teddy, do NOT build unless he asks)
- **Truer callback rate keyed on `unit_id`** (per-appliance) instead of the current same-`customer_id`≤30d proxy
  (`:268-273`) — `unit`/`job.unit_id` exist; more accurate, more work.
- **Revenue/collected trend over time** (date-bucketed sparkline) — nice-to-have, client-side or a new endpoint.
- **Review count/velocity** — the real net-new item: needs a Google Business Profile ingestion or a manual
  entry field before it can be a KPI. Teddy's call whether it's worth it (TN already has Google reviews via the
  legacy side; the platform just doesn't store them yet).

## Critical files
- **EDIT:** `platform/owner.html` — add the Avg-ticket tile in the `render()` KPI row (~`:395-398`), computed
  from `completed.length` (`:263`) + `collected`/`billed` (`:282`). **REUSE:** `tile()` (`:1020`), `USD()`
  (`:178`), the existing window selector + feature gate. No new endpoint, no schema, no writes.
- **NO CHANGE:** `platform/office-overview-tk.html` is a Keep/Change/Remove review page, not a KPI page —
  leave it; it already points TK at owner.html for "the money."

## Verification
- Sign into `owner.html` on the demo/TN tenant → the new **Avg ticket** tile shows a sane value (collected ÷
  completed) that changes with the week/month/YTD selector; a 0-completed window shows `—` not `NaN`; the
  feature-gated (no-database) view is unchanged.
- Static-preview the render for the tile layout if needed (sandbox can't reach Supabase for a live authed load).
- Deploy: branch `claude/shop-automation-setup-r9wzpm` → ff-merge main → push (retry/backoff) → Netlify → curl
  the page 200 + confirm the "Avg ticket" marker is present. No outward/money flags. Commit trailer per rules.

## Where TK's onboarding stands (no build — status for the close)
Everything else for TK is already staged (DONE this session/prior): Workiz import bugs fixed, `office-overview-tk.html`
built, `docs/tk-onboarding-runbook.md` written, reseller commission set to **30% LIFETIME** (verified live). The
one-pass onboarding runs the moment TK sends his **Workiz API token + TK's email + CSR's email** (per the runbook).

---

# 🎬 ACTIVE (2026-09-08) — Best "put yourself in an AI-generated ad" tool + the moat-safe recommendation

## Context / why
Teddy shared a **Render AI** ad — "put yourself in an AI-generated ad, concept to finished ad in minutes"
(a real barbershop owner in a polished AI-produced spot). It lands squarely on the commercials track already
built (`docs/founder-film-quickstart.md` + `docs/commercial-production-kit.md §3` = the full Founder Film
script + gen-prompts). He picked (AskUserQuestion): **make BOTH the AssistAnt founder ad + the TN consumer
spot, founder FIRST**, and **"just recommend the best tool"** (not a run-it-kit, not me-produce-here).

**The decision that shapes everything = his authenticity moat.** His edge over FixCall/HighLevel is that a
REAL appliance-shop owner built + runs it. Verified (WebSearch, 2026) the tool split: some tools clone YOUR
OWN likeness (HeyGen from ~15s of video; Captions from one selfie), others give STOCK AI actors (Arcads
1,000+, Creatify 1,500+). A stock actor playing "a shop owner" is a lie that kills the moat; a clone of HIS
OWN face saying HIS OWN words about HIS OWN product, disclosed as an ad, is honest — but still synthetic, so
the ANCHOR founder film (the one he sends warranty cos + creators) lands hardest as genuinely-him on camera.

## Deliverable — `docs/ai-ad-tool-recommendation.md` (forwardable) + the verdict handed to Teddy in chat
Docs-only. No code, no deploy, no spend. Concise, mirrors the commercial-kit tone.

### THE VERDICT (one line)
Film the real founder anchor yourself (no tool for the face — script's ready); buy **HeyGen ($29/mo, free
tier = 3 videos to try)** as the "make-an-ad-in-minutes" tool to clone your OWN likeness for the fast social
cuts + the consumer spot + a Spanish dub. **Never a stock-actor tool for anything "owner/founder."**

### Tools ranked FOR TEDDY (real-face requirement)
1. **Real phone footage of you** — $0, already scripted (founder-film-quickstart). Best possible for "built
   by a real shop." Use for the anchor film.
2. **HeyGen — $29/mo** — clones you from ~15s of video ONCE → generate the founder pitch + consumer spots
   fast, real-your-likeness, Avatar IV/V (identity + micro-expressions), **175 languages incl. Spanish for
   TN**, clone + script + post in one sub. The best all-around "put yourself in an AI ad" buy. Free tier first.
3. **Captions — $25/mo** — phone-first, clones from ONE selfie, drive it entirely from your phone (fits your
   on-the-road workflow). It's a short-form editing app with the AI twin as a feature. Solid #2.
4. **Render AI (your screenshot)** — same class (photo→talking-you), fine; but less proven on identity
   fidelity + no standout language/dub story vs HeyGen. If you already like it it works — I'd still start on
   HeyGen's free tier and compare.
5. **Arcads / Creatify — SKIP for founder/owner ads** (stock actors, not you → kills the moat). Only ever
   relevant later for A/B-testing many UGC hooks with actors for the SaaS — a different play, never for "I'm
   a real shop owner."

### Sequencing (both, founder first)
- **Founder anchor** = film real you (script ready) → polish in Submagic/CapCut → distribute via the live
  `post-everywhere` (FB/IG/TikTok/YouTube, one tap).
- **Then** clone yourself in HeyGen (one 15-sec clip) → knock out the fast SaaS cuts + the "Broken at 2am"
  consumer spot + a Spanish version → same one-tap distribution.

### Honesty line (keep it)
Real-you for the anchor; your-own-clone (NEVER a stock actor) for volume/dubs; every claim true; always
disclosed as an ad. Don't let a tool put words in a fake person's mouth about your shop.

### What I hand you the moment you pick a tool (next step, not this task)
The exact 15-sec clip to record to clone yourself (framing/lighting/what to say), the founder + consumer
scripts (from founder-film-quickstart + commercial-production-kit §3/§4) formatted to paste into the tool,
and — if you vault `ELEVENLABS_API_KEY` — a Spanish VO/dub of the finished spot.

## Critical files
- **NEW:** `docs/ai-ad-tool-recommendation.md` (the recommendation above, forwardable).
- **REUSE (reference/quote):** `docs/founder-film-quickstart.md`, `docs/commercial-production-kit.md` (§3
  founder film, §4 "Broken at 2am" consumer, §6 ElevenLabs VO/Spanish dub, §7 post-everywhere distribution).

## Verification
- Doc reads clean + forwardable; ONLY-true claims; the moat/honesty line explicit; pricing accurate to the
  2026 sources; ties into the existing founder-film + commercial docs. No sandbox AI-video claim (honest
  about the external render step). Docs-only → commit on the feature branch → ff-merge main → push
  (docs-only won't trigger a Netlify build — fine, it's a repo reference). No outward/money flags.

---

# ✅ DONE (2026-09-08) — RARE FOCUSED DAY: all 3 tracks shipped + verified live (commit 918a2c01)
- **T1 growth (all 3 gaps live):** Meta `consumer` kit (always-open + LOCAL radius geo Nashville+BR) verified;
  SaaS-signup→OpenAI `lead_created` conversion wired at `platform-stripe-webhook.js` fires-once block + proven
  authorizing (validate-only ok:true, matched email+phone); `?ref=` captured+carried through `/guide`→signup
  (free-guide.html + lead-magnet.js, honeypot-safe). **Google/Meta SaaS-conversion = honest follow-ons**
  (Google needs a gclid chain; Meta has no server CAPI uploader yet).
- **🔑 KEY FINDING — ChatGPT Ads is FULLY configured + growth already ON:** `openai-ads-diag` → has_api_key +
  has_conversion_key + has_pixel_id ALL true, account active/approved. So today's conversion wire is **LIVE, not
  dark.** Existing campaigns: **1 ACTIVE** ("TN Appliance Exchange campaign", clicks, spending) + **4 dup PAUSED**
  "AssistAnt — Shop Software — US (Ant)" (harmless $0 housekeeping). Teddy-gated: confirm the active one / clean
  the 4 dups (I can, on his go) / spin a fresh /guide $25/day test. Do NOT flip/delete without his word.
- **T2 commercials:** 5 run-ready ad PNGs rendered (headless Chrome + real brand fonts/palette + real Cybertruck
  photo) + delivered via SendUserFile; `scratchpad/ads/` generator committed; `docs/founder-film-quickstart.md`.
- **T3 close TK:** commission (30%/12mo sub_pct, active) + reseller-agreement §3 were ALREADY set 2026-09-07
  (verified live `do=report`); `/r/TK`→signup?ref=TK 302 verified. Remaining = the nudge (drafted, Teddy sends).
- Creator onboarding = Teddy supplies handles → one `platform-partner do=upsert ... commission_pct=30 &commission_months=12` each.

# 🗓️ (executed) TODAY (2026-09-08) — RARE FOCUSED DAY: 3 tracks, hardest-first (Teddy home + engaged)

## Context / why
Teddy has a rare work-from-home day and wants MAX output. Via AskUserQuestion he picked THREE tracks:
**(1) Turn growth ON · (2) Get commercials made · (3) Close customer #2 (TK).** The advertising + IP
strategy work already shipped (commit 978d8389: Creative Concepts artifact fe27a46a, IP plan + invention
disclosure, partner-program + commercial-production kits). This section = the concrete BUILD plan for the
three tracks, in build order. **Standing gate: I never flip a live/spend flag or vault a key — every
outward/money step is Teddy's explicit go** (`PLATFORM_SIGNUP_LIVE`, any `&live=1`/campaign ACTIVE, key
vaulting). Ground truth confirmed by recon (2026-09-08) is baked into each track below.

---

## TRACK 1 — TURN GROWTH ON (build the 3 no-spend gaps + stage the ChatGPT launch + onboard creators)

### 1a. OpenAI/ChatGPT SaaS ad — READY, stage it (create side is complete; only the launch is Teddy-gated)
Recon: `openai-ads-create-campaign.js` has a first-class **`saas` kit** (lines 45–56) landing on **`/guide`**
(the lead magnet, line 49), a national default, owner-targeted copy, and a proper **PAUSED→`&live=1`** gate
(lines 86–87); `configured()` is gated on `OPENAI_ADS_API_KEY` (`_lib/openai-ads.js:60`). **No code change
needed to launch** — it's operational:
- **Preview (no spend, no key needed):** `openai-ads-create-campaign?secret=<admin>&appliance=saas&budget=25&days=30`
  → confirm `final`=/guide, national geo, owner copy, `mode:preview`.
- **Teddy vaults 3 keys** (via `admin-secrets.html`): `OPENAI_ADS_API_KEY` (Ads Management), `OPENAI_ADS_CONVERSION_KEY`
  (separate Conversions key), `OPENAI_ADS_PIXEL_ID`. Then `openai-ads-diag?secret=` → `configured:true`.
- **Create PAUSED:** `…&apply=1` → makes the campaign PAUSED (safe review state). **Go live (Teddy's spend
  step):** `…&apply=1&live=1` at ~$25/day national → `/guide`. His AskUserQuestion pick (national/$25/guide) +
  plan approval = the go; nothing charges until this flip.
- ⚠️ first real apply may need one ad/targeting field-name tune (OpenAI documents the campaign body, not the
  full ad schema) — caught on the first fire, nothing wasted.

### 1b. Gap A — Meta CONSUMER kit (the missing homeowner-repair Meta campaign)
Recon: `meta-ads-create-campaign.js` has 3 kits, **ALL B2B-to-shop-owner** (`appliance`→/guide, `referral`+
`product`→assistant247.net); no homeowner kit; always PAUSED; no `&live=1`. **Build:** add a `general`/
`homeowner` consumer kit to the `KITS` map at **`meta-ads-create-campaign.js:56`** (after `product`) — appliance-
repair customer interest targeting + homeowner copy ("Broken at 2am? We Answer") + `link` → `always-open.html`
(or `appliance-ai.html`). No other change needed (line 66 resolves `q.kit` dynamically; every object still
ships PAUSED). Preview-only from our side; the ACTIVE flip stays manual in Ads Manager after Teddy vaults
`META_AD_ACCOUNT_ID` + `META_ADS_TOKEN`.

### 1c. Gap B — SaaS-signup → ad-channel conversion feedback (so SaaS ads optimize on real signups, not blind clicks)
Recon (the real one): a SaaS signup is recorded ONCE at **`platform-stripe-webhook.js:156`** (`event` type
`platform_signup_provisioned`, inside the deduped `if(!already)` block, lines 154–172 — `companyId`, `email`,
`meta.plan`, `refCode` all in scope). **NONE of the 3 ad sweeps see it** — they read Xano `event_log` + require
a self-pay repair `job` row, and **no Meta uploader exists at all.** So SaaS conversion feedback is net-new per
channel; wire the ONE that works cleanly today, note the other two honestly:
- **OpenAI (build now — clean win):** OpenAI matches on **hashed phone/email**, which we HAVE at signup. Fire a
  conversion from the webhook's fires-once block (insert at **`platform-stripe-webhook.js:159`**) by calling the
  existing `uploadOpenAiConversion({event_type:'lead_created'|'order_created', phone, email, value})` from
  `openai-ads-upload-conversion.js` — best-effort, try/caught so it NEVER breaks the paid provision, and gated on
  the conversion key being vaulted (no-op/dark until then). This closes the loop for the 1a campaign.
- **Google (follow-on, honest gap):** Google offline conversion **requires a `gclid`** (its sweep hard-requires
  one, `google-ads-conversion-sweep.js:42`). The SaaS ads land on `/guide` → signup, so a gclid would need to
  ride `/guide → signup` (capture on the /guide/ad landing, persist through to the signup POST). Scope as a
  documented follow-on, not v1 (it's a plumbing chain, not a one-liner).
- **Meta (follow-on, honest gap):** **no Meta CAPI/offline-conversion uploader exists** — a whole new
  `_lib/meta-capi.js` + uploader is required to feed Meta SaaS conversions. Documented follow-on. (The Meta
  Pixel already fires `Lead` on signup client-side, `signup.html:250` — that covers browser-side pixel matching;
  server-side CAPI is the deeper add.)

### 1d. Gap C — `?ref=` attribution through `/guide` (cold B2B a partner sends to /guide keeps attribution)
Recon: `?ref=` is **dropped at the first hop** — `free-guide.html` never reads `location.search` (POST body
line 177 omits ref); `lead-magnet.js` never accepts/stores ref (insert lines 83–86). Ref is only ever honored
much later at `platform-stripe-webhook.js:90` (validated against an active `partner`) via `platform-signup.js:137`.
**Build (small, 2 files):**
- **`free-guide.html` (~line 162 + 177):** on load read `new URLSearchParams(location.search).get('ref')` →
  stash in `window.__ANT_REF` + `localStorage` (privacy: strip it from the URL before the Meta Pixel fires,
  same discipline as `signup.html`) → add it to the POST body at 177.
- **`lead-magnet.js` (70–74 + 83–86):** accept `b.ref`, store it on the `prospect_message` row.
- **Carry-through:** make the /guide forward CTA (the `<a href="/ant">`, free-guide.html line 152) append
  `?ref=<code>` so a visitor who clicks through to the tour/signup keeps attribution end-to-end. (The eventual
  signup POST reattaches it as `b.ref` → the existing validate-at-webhook path takes over.)

### 1e. Onboard the first CREATOR partners (Tier A — turnkey today)
The partner engine is live (`platform-partner.js do=upsert` mints code + `pt_` dashboard token + `/r/<code>`
link; `?ref=` attribution real + partner-gated). One command per creator:
`platform-partner?do=upsert&secret=<admin>&code=<HANDLE>&name=&email=&commission_type=sub_pct&commission_pct=30&commission_months=12`
→ hand them `/r/<HANDLE>` + `partner.html?token=…` + the co-produced commercial. **Teddy sets the commission %
(30%/12mo mirrors TK — his AskUserQuestion answer applies) + supplies the warm handles** (Ken King, Marc Lavelle,
Jessica Anne from `docs/group-outreach-playbook.md`). DM openers are paste-ready in `docs/assistant-partner-program.md`.

---

## TRACK 2 — GET COMMERCIALS MADE (run-ready graphics today + the Founder-Film render kit)
Recon ground truth: `scratchpad/ad-concepts.html` is polished HTML mockup BOARDS, not exportable graphics —
there is **no correctly-sized ad PNG in the repo** and **no in-repo image-render tooling** (the OG PNGs are
hand-authored `assets/brand/og-image-source.svg` → committed PNGs; the only Playwright is for parts logins).
BUT the sandbox has **Chromium pre-installed + Playwright configured** (env: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`),
so the render step = author precise-dimensioned HTML cards and screenshot them headless. Real brand assets are
on hand: `icons/ant-512.svg`, `assets/marketing/{crew-1,crew-2,truck-sky,truck-wrap-square,truck-wrap-wide}.jpg`,
`team/teddy-owner.jpg` + crew headshots; palette (`--ink #0b0c10 / --cream #f3ead6 / --gold #e7c255 / --emerald
#4bbf8a / --clay #d9694a`) + fonts (Fraunces/Archivo/Anton) live in `ad-concepts.html:5-24` + the kit.

### 2a. Run-ready static ad PNGs — the "post it today" win
- **`scratchpad/ads/*.html` (NEW):** one self-contained HTML card per static concept, sized EXACTLY to social
  specs (1080×1080 feed, 1080×1920 story, 1200×630 link), reusing the `ad-concepts.html` palette/fonts + the
  ant mark + the real crew/truck/founder photos where the concept calls for them (e.g. Teddy's photo in the
  founder line, a truck-wrap in the consumer spots). Concepts to render: **The Boulders** (SaaS), **They Take a
  Message. We Book the Job.** (SaaS), **Broken at 2am? We Answer.** (consumer), **The Honest 4 Options**
  (consumer), **Copycats Can't Clone This** (SaaS free-guide). Lead with the ones that match the campaigns going
  live — SaaS → /guide (the ChatGPT launch, 1a), consumer → always-open (the new Meta consumer kit, 1b).
- **`scratchpad/ads/render.js` (NEW):** small Playwright script — loads each card, `setViewportSize` to its exact
  dims, waits for `document.fonts.ready`, `page.screenshot()` → PNG in `scratchpad/ads/out/`. Uses the pre-installed
  Chromium (do NOT `playwright install`). (rsvg/ImageMagick fallback only if Chromium screenshot flakes.)
- **Deliver via `SendUserFile`** so Teddy can post them today — manually, or drop them into the LIVE
  `post-everywhere` fan-out (§2c). ONLY-true copy (no fabricated stats), on-brand.

### 2b. Founder-Film render walkthrough — the video, made actionable
The kit `docs/commercial-production-kit.md` §3 already fully specs the Founder Film (6 scenes + VO + on-screen
text + per-scene Sora/Veo/Runway/Kling gen-prompts; flags S4 = real product screen-rec, S3/S5/S6 = real Teddy
footage). **Build `docs/founder-film-quickstart.md`** — the tight "render it today" sequence: (1) pick ONE AI
video tool → paste the per-scene prompts from §3; (2) shoot the real bits on a phone (Teddy on camera S3/S5/S6
using `team/teddy-owner.jpg` as the look ref, screen-record the live product for S4); (3) VO via ElevenLabs
(§2d) or a clean phone-recorded read; (4) assemble in CapCut (captions/music per §0); (5) publish via
`video-studio.html` → `post-everywhere` (§2c). One page, no jargon, forwardable to an editor.

### 2c. Distribution — already LIVE, just point at it
Reuse (no build): `video-studio.html` → `netlify/functions/post-everywhere.js` → `video-post.js` fan-out to
**FB/IG/TikTok/YouTube** (`_lib/tiktok`/`_lib/youtube`, YT posts private-draft). The finished Founder Film clip
+ the static PNGs drop straight into this.

### 2d. Optional — AI voiceover (Teddy-gated key)
`_lib/elevenlabs.js` is fully wired (`check`/`listVoices`/`tts`), dormant until `ELEVENLABS_API_KEY` is vaulted.
On Teddy's go I render the Founder-Film VO track from the §6 script (or he uses a phone read / human VO). Not a
blocker for the graphics or the video shoot.

---

## TRACK 3 — CLOSE CUSTOMER #2 (TK): lock 30%/12mo + hand Teddy the nudge + tighten signup→setup

### 3a. Set TK's reseller commission (Teddy already decided: 30% sub / 12 months)
Live config write (records the rate + lights up his dashboard math; **no money moves** — payouts stay admin-driven
via `do=record_payout`):
`platform-partner?do=upsert&secret=<VAPI_ADMIN_SECRET>&code=TK&commission_type=sub_pct&commission_pct=30&commission_months=12`
⚠️ do NOT touch the customer Ant-Army credit (`PLATFORM_REFERRAL_CREDIT_LIVE`) — separate rail; this is TK's
RESELLER partner row only.

### 3b. Fill the agreement's commission blanks to MATCH (30% / 12 months)
Edit `docs/partner/tk-reseller-agreement.md`: §3.1 → "30% of net subscription revenue actually collected"
(delete the flat-$ alternate); §3.2 → "12 months from the account's activation date" (delete the lifetime
alternate); check off the two checklist items. LEAVE for Teddy+counsel: legal names/entities/states/addresses,
NDA date, territory, governing-law, effective date, payment method. Keep the NOT-LEGAL-ADVICE banner; counsel
finalizes before TK signs. Docs-only (no Netlify build).

### 3c. The nudge (Teddy sends from his phone — I draft)
Warm founder-to-founder text to get the 4 blocked onboarding items: (1) Workiz API token (Workiz → Settings →
API), (2) TK's email + his CSR's email (logins), (3) his Ann phone line, (4) hours/service-area/FAQ for Ann.
Frame: "your Ann's upgraded + ready; once your CSR sends these your book imports + Ann answers every caller by
name + she gets her own login" — plus the reseller side is locked (30%/12mo, his link `signup.html?ref=TK`,
dashboard `partner.html?token=pt_2e274606b78803f0c1db43c52f3adbb3`) so he's motivated to refer.

### 3d. When TK's CSR sends the items (NOT today — runs on arrival)
Follow `docs/tk-onboarding-runbook.md`: provision `the-appliance-guy` (⚠️ NO `ref=TK` on his OWN tenant) →
Workiz import (wizard/API — the preview/commit bugs are already fixed) → attach Ann to his board → CSR login.
Blocked only on the 4 items above.

---

# 🎯 ACTIVE (2026-09-08) — AGGRESSIVE ADVERTISING + INFLUENCER OFFERS + POLISHED COMMERCIALS (SaaS + TN repair)

## Context / why
Teddy wants the most aggressive advertising + to put offers in front of the people who move whole trades, backed by polished/AI-produced commercials that beat the competitor ads he's seeing (FixCall AI, HighLevel "too many tools" boulders, Vibe.co cinematic). Decisions locked (AskUserQuestion 2026-09-08): target ALL THREE influence tiers (trade creators/group-leaders + industry heavyweights + trade media/associations); commercials = POLISHED / AI-produced; advertise BOTH the SaaS (AssistAnt) AND TN's consumer repair. Teddy's conviction: "I know what these guys are looking for and worried about — we're the company that helps them accomplish their goals." His authenticity (a real shop owner who built the fix) is the moat even inside polished production — and it's the one thing FixCall/HighLevel can't say.

## The positioning spine (every ad + offer runs on this)
Their FEAR (what the competitor ads prey on) → their GOAL → why WE'RE the answer:
- Competitors stealing jobs / missed calls → win every job → AssistAnt answers 24/7 AND books/parts/routes it (FixCall just takes a message).
- Too many tools/subscriptions (HighLevel boulders) → one simple system → $99 flat, every tech included, not five tabs / not per-seat.
- Told what to charge / losing control → run it my way → the customer picks 4 honest options.
- Undersold / stressed / chained to the phone → be the trusted dominant local shop → built by a real shop that lives your day.
Flagship emotional arc: **stressed-in-the-van → in-control owner.** Same before/after energy as the FixCall ad, but we out-scope them and we're real.

## Honest production reality (the "how" for polished/AI spots)
Repo has a LIVE real-footage pipeline (video-studio → Cloudflare Stream → Submagic captions / Vizard clipping → post-everywhere fan-out to FB/IG/TikTok/YouTube) + a Claude copy engine + ElevenLabs voice (connector built, needs key). It has NO AI-video or AI-image generator, and I can't render video from here. So the deliverables split:
- **Static image ads** (boulder-metaphor, before/after meme, comparison — 4 of the 5 refs are composed stills w/ text): I DESIGN these as finished, polished, on-brand graphics (artifact/canvas, export-ready). Runnable on Meta/FB/IG immediately — the fastest concrete win.
- **Cinematic video spots**: I write the full script + scene-by-scene AI-generation prompts (paste into Sora/Veo/Runway) + storyboard + ElevenLabs VO script + on-screen text + music/pacing; Teddy or an editor renders; the finished clip drops into the LIVE post-everywhere fan-out.
- Authenticity baked in: Teddy's real "I own a shop, got tired of losing jobs, built this" line inside the polish.

## WORKSTREAM 1 — The commercials (BUILD NOW, no spend/keys)
Deliver a published **Creative Concepts artifact** (so Teddy SEES them + reacts) + `docs/commercial-production-kit.md`. Flagship set:
- **SaaS "The Boulders"** (beat HighLevel): tradesman crushed under Housecall Pro / Jobber / Workiz / Podium boulders → stands free with one phone = AssistAnt. "$99. One system. Built by a real shop." → /guide or /ant. [static, designed]
- **SaaS "They Take a Message. We Book the Job."** (beat FixCall): before/after meme — stressed van, competitor takes the job → AssistAnt answers 24/7, books it, tech relaxed. → /guide. [static + short video]
- **SaaS "Built by a shop owner"** (cinematic, Vibe.co polish + authenticity): Teddy's founder story — the film for the influencer/heavyweight pitches. [video kit]
- **Consumer "Broken at 2am? We Answer"** (cinematic): TN repair → always-open.html / appliance-ai.html. [video kit]
- **Consumer "The Honest 4 Options"** (real-tech, honest pricing) → appliance-ai.html. [static + video]
Static ads on-brand (gold #e7c255 / dark #0b0c10, ant mark, Georgia serif); video ones get script + gen-prompts + storyboard + VO. Teddy unlock for AI voiceover: vault ELEVENLABS_API_KEY.

## WORKSTREAM 2 — Offers to the 3 influence tiers (BUILD NOW, no spend)
Reuse the partner engine (one `platform-partner do=upsert` mints code + `pt_` token + dashboard + `/r/<code>` link; `?ref=` attribution is LIVE + real-partner-gated + fires at first payment). Deliver a master **`docs/assistant-partner-program.md`** + per-tier pitch kits + target lists (forwardable):
- **Tier A — creators / FB-group / YouTube leaders** (best fit — the affiliate model IS this): a "Creator Partner" offer — aggressive commission (Teddy sets %; TK's 30%/12mo is the model to mirror), their dashboard + link, and the co-produced commercial they run to their audience. Target list of named FB appliance/HVAC group admins, YouTube repair channels, trade podcasts. Optional small build: a creator self-apply capture page (reuse the lead-magnet / platform-contact rail) → I onboard via do=upsert. Honest gaps: no self-enroll portal + payouts are manual (record_payout) — fine at this scale.
- **Tier B — heavyweights** (warranty cos / distributors / franchises): a partnership/white-label pitch one-pager per type + the reseller-agreement + NDA templates as the paper. Honest: real distributor/franchise economics (bulk/override/white-label) are a future build — v1 = the pitch + a "bring your book" conversation, not automated economics.
- **Tier C — trade media / associations**: a sponsorship/endorsement pitch + a member-discount offer (reuse the Stripe coupon machinery behind Ant Army as an association promo code) + target list. Honest: the member-discount coupon surface is a small build if pursued.

## WORKSTREAM 3 — Aggressive multi-channel launch (both products; Teddy-gated flips)
Reuse the built kits; close the buildable gaps; Teddy flips spend + vaults keys.
- **Google consumer** = LIVE (scale/keep). **Google SaaS** = staged preview → launch (`&apply=1&enable=1`). **OpenAI SaaS + consumer** = ready → `apply=1` (PAUSED) → `live=1` (spend). **Meta** = DARK for both → Teddy vaults `META_AD_ACCOUNT_ID` + `META_ADS_TOKEN` → `apply=1` (PAUSED) → manual ACTIVE flip in Ads Manager.
- Buildable gaps I close (no spend): (a) a **Meta CONSUMER kit** (none exists — required for an aggressive consumer Meta push); (b) **SaaS-signup conversion feedback** to Meta/Google/OpenAI (today all sweeps feed CONSUMER jobs only → SaaS ads optimize blind on clicks) — wire platform-signup → a conversion event per channel; (c) **?ref= propagation through /guide** so cold B2B traffic that lands on the lead magnet attributes to a partner.
- The Workstream-1 commercials become the creative for these campaigns.

## Sequencing
- **Phase 1 (build now, NO gates — fastest visible win):** Workstream 1 (Creative Concepts artifact + production kit) + Workstream 2 (Partner Program doc + tier kits + target lists). Gives Teddy commercials to SEE + offers to SEND today.
- **Phase 2 (gated on Teddy):** Workstream 3 launch flips + the 3 buildable ad-infra gaps.

## Critical files
- **NEW:** a published Creative Concepts artifact (static ad designs + video storyboards); `docs/commercial-production-kit.md`; `docs/assistant-partner-program.md` + per-tier pitch kits + target lists; (Phase 2) a Meta consumer kit in `meta-ads-create-campaign.js`, SaaS-signup conversion wiring, `/guide` ref propagation.
- **REUSE (no rebuild):** `platform-partner.js` (do=upsert/report/record_payout) + `partner.html` + `docs/partner/tk-*.md` (agreement+NDA) + `docs/group-outreach-playbook.md`; the video pipeline (`video-studio.html` / `post-everywhere.js` / `_lib/social-variants.js`), `_lib/elevenlabs.js`, `content-ideas` / `_lib/ant/brain-core.js`; the ad builders (`meta-ads-create-campaign.js` / `google-ads-create-campaign.js` / `openai-ads-create-campaign.js`) + `docs/referral-ad-copy.md`; brand assets (`assistant-og.png`, `referral-og.png`, truck/crew photos, `icons/ant-512.svg`, gold/dark palette).
- **Landing:** SaaS → /guide, /ant (system.html), signup.html; consumer → appliance-ai.html, always-open.html.

## Teddy-gated actions (I never flip spend or vault keys)
Vault `ELEVENLABS_API_KEY` (AI voiceover); vault `META_AD_ACCOUNT_ID` + `META_ADS_TOKEN` (Meta paid); vault `OPENAI_ADS_CONVERSION_KEY` + `OPENAI_ADS_PIXEL_ID` (ChatGPT conversion loop); set the creator commission %; flip each campaign ACTIVE; render/assemble the video spots from the kits.

## Verification
- **Phase 1:** the Creative Concepts artifact publishes + shows the flagship static ads (on-brand, export-ready) + the video storyboards; the production kit + partner-program docs read clean, forwardable, ONLY-true claims; a test `platform-partner do=upsert` mints a code + dashboard + /r/ link for a sample creator (then clean it up).
- **Phase 2:** each ad kit previews for both products with the right landing page + the new creative; the Meta consumer kit builds PAUSED; a SaaS signup fires a conversion event to each channel (dry-run); `?ref=` survives a /guide → signup journey. Standard deploy: branch → ff-merge main → push (4× retry/backoff) → Netlify → curl live. Commit trailer per session rules; no model ids in commits. NO spend/key flip by me.

---

