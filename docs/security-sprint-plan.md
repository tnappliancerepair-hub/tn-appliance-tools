# Security Sprint Plan — V3 Tasks 57-80 Status

Generated 2026-05-27 overnight as part of V3 sweep.

## Shipped in this V3 pass

- **56 ✓** Office password no longer in client-side HTML. 14 pages now call
  `verify_office_password_POST` which checks `$env.OFFICE_PASSWORD`.
- **57 ✓** All 14 office pages migrated to server auth (same task).
- **65 ✓** `check_rate_limit_GET` endpoint.
- **66 partial** `record_rate_limit_hit_POST` endpoint shipped; callers
  (quote / customer-portal-action / generate_quote / record_inbound_call)
  still need to wire the check.

## Deferred — operator action required first

- **58, 59, 60** Per-user office accounts + bcrypt + JWT signin. Needs:
  - `office_user` table + columns
  - bcrypt-equivalent in Xano (built-in `crypt:bcrypt` filter exists)
  - JWT issuance + verification (Xano supports natively)
  - Migration plan: keep shared password as fallback while users created
- **62** TOTP 2FA. Requires `otplib` Netlify function + setup flow.
- **63, 64** PII masking helper in event_log writes. Touches 30+ writer
  sites; better as a focused PR than scattered edits.
- **67** Telnyx voice webhook HMAC verify. Need Telnyx signing-secret.
- **70** CORS lockdown on Netlify functions. `netlify.toml` config.
- **71** CSP headers — same.
- **74** `npm audit` pass.
- **75, 79, 80** Mac Mini physical-access hardening, webhook replay
  prevention, security disclosure policy — pure documentation tasks.

## Immediate next steps for operator

1. Set `$env.OFFICE_PASSWORD` in Xano workspace to something stronger
   than the current default (`antlives`).
2. Schedule a dedicated security sprint for Tasks 58-80 (estimate ~1 week).
3. Get Telnyx voice signing secret + Stripe live keys + OpenAI key
   so the deferred items have what they need.

## What this leaves unprotected

- **Office password is still shared** — anyone with the password can
  do anything. Per-user accounts (Task 58) are the fix.
- **No rate limiting on quote/portal-action endpoints yet** — abuse
  possible. The endpoints are shipped (Task 65/66), wiring is the gap.
- **PII in event_log** — customer phones written raw. Should be masked
  to last4 only in logs.

These are real-but-not-emergency. The catastrophic 'password in HTML
view-source' issue is closed tonight.

🐜
