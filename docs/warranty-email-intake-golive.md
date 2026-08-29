# Warranty-email intake — go-live runbook

**What it does:** a warranty company (AHS, ServicePower, SquareTrade, Frontdoor, NSA, Cinch, 2-10…)
emails a job dispatch → it lands on the shop's AssistAnt board automatically, deduped, with the
customer, address, appliance, brand/model, claim #, and problem already filled in.

**The shop's part is one step:** forward warranty dispatch emails to `‹slug›@jobs.assistant247.net`.
No inbox to connect, no polling, no copy-paste.

---

## Architecture (already built + tested)

```
warranty co. ──email──▶ <slug>@jobs.assistant247.net
                              │  (Cloudflare Email Routing catch-all)
                              ▼
                     Cloudflare Email Worker  (cloudflare/email-intake-worker)
                       parses MIME + XML attachment
                              │  POST JSON
                              ▼
              /.netlify/functions/platform-email-intake
                 • resolve shop by the <slug> in the address
                 • idempotent per Message-ID, dedup per claim #
                 • parse: AHS XML · ServicePower/SquareTrade text · Claude fallback (any format)
                 • create the job on that shop's board (RLS-scoped)
                 • log to email_intake (owner's "Emailed jobs" feed) + text the owner
```

Verified live on the demo tenant: AHS XML, ServicePower/SquareTrade, and an unknown "Cinch"
format (Claude fallback) each created a correct job; idempotency + claim-dedup + non-dispatch-skip
all hold.

---

## Go-live — Teddy's Cloudflare steps (~15 min, one time)

1. **Pick the intake domain.** Recommended: the subdomain `jobs.assistant247.net` (keeps intake mail
   isolated from any other mail on `assistant247.net`). Add it as a zone in Cloudflare if it isn't one,
   OR — simpler — just enable Email Routing on `assistant247.net` and use `‹slug›@assistant247.net`
   (the code reads only the part before the `@`, so either domain works; if you use the apex, tell me
   and I'll flip the one display string). The steps below assume `jobs.assistant247.net`.

2. **Enable Email Routing** on that zone (Cloudflare → the zone → **Email → Email Routing → Get started**).
   Cloudflare adds the MX + SPF records for you.

3. **Deploy the worker:**
   ```
   cd cloudflare/email-intake-worker
   npm install
   npx wrangler login
   npx wrangler secret put PLATFORM_EMAIL_SECRET   # paste the shared secret (see step 5)
   npx wrangler secret put FALLBACK_INBOX          # e.g. tnappliancerepair@gmail.com (a verified dest.)
   npx wrangler deploy
   ```

4. **Bind the catch-all** (Cloudflare → Email → Email Routing → **Email Workers**): set the
   **catch-all address** to run the `assistant-email-intake` worker. (Verify `FALLBACK_INBOX` under
   **Destination addresses** first — Cloudflare emails it a confirm link.)

5. **Set the shared secret in the platform vault** (admin-secrets → key `PLATFORM_EMAIL_SECRET`) to the
   SAME value you gave the worker in step 3. That's the only thing gating the intake endpoint.

That's it. From then on, any `‹slug›@jobs.assistant247.net` that receives a dispatch lands a job.

---

## Onboarding a shop (per tenant, ~2 min)

Give the shop their address — `‹their-slug›@jobs.assistant247.net` — and have them add ONE forward
rule to it, in whichever place their dispatches arrive:
- **Warranty portal** (AHS/ServicePower/etc.): set the dispatch-notification email to their address, or
- **Their inbox**: an auto-forward filter for the warranty sender → their address.

Then the owner sees every emailed job appear on the board, and the **📥 Emailed jobs** card on
owner.html shows exactly what came in (vendor, how it parsed, confidence, the job it became).

---

## Safety / reliability

- **Never lose a dispatch:** if intake fails for any reason, the worker forwards a copy of the raw
  email to `FALLBACK_INBOX` so a human still gets it.
- **Idempotent:** the same email (Message-ID) is processed once; a re-sent dispatch (same claim #)
  reuses the existing job instead of duplicating.
- **Any format:** unknown vendors fall back to a Claude extraction (Haiku) — onboarding a new warranty
  company needs zero code. Confidence is logged so the office can eyeball low-confidence parses.
- **Tenant-isolated:** the job is stamped with the shop's company_id in code (service key); a shop
  can only ever receive its own jobs.

## Files
- `netlify/functions/platform-email-intake.js` — the intake endpoint
- `netlify/functions/_lib/warranty-email.js` — the universal parser (AHS XML + ServicePower + Claude)
- `docs/sql/044_email_intake.sql` — the email_intake ledger + job.dispatch_id/service_window
- `cloudflare/email-intake-worker/` — the Cloudflare Email Worker
