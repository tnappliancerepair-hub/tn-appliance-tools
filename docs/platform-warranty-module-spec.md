# Platform "Connect Your Warranty Companies" — build spec (multi-tenant, sellable)

_Status: SPEC (not built). Kicks off after TN's own AHS/Frontdoor round-trip proves the payload
shapes on our own account (see `docs/ahs-api-plan-2026-08-06.md` + the legacy `frontdoor-webhook.js`).
Prompted by Teddy 2026‑08‑31 — "can we build something other companies can attach themselves to as well."_

## Why this exists (the moat)
Other appliance shops attach **their own** warranty work to the AssistAnt platform. Each shop uses its
own warranty accounts — **we're the software that runs them**, not a sub-contractor routing work through
TN's account. Warranty is ~95% of this industry's work, so the line that makes a warranty shop switch is:

> "Bring your warranty work — off AHS, SquareTrade, NSA, all of it. It auto-appears on your board, status
> syncs both ways, and you stop typing in five different portals."

No thin phone-only competitor can say that. This is the platform's warranty-integration layer.

## The two tiers (what a shop gets)
The design is two tiers so a shop gets value **instantly**, with an API upgrade for the shops that qualify.

### Tier 1 — instant, ZERO approval, any warranty company
The shop forwards its warranty dispatch emails to its own address `‹slug›@jobs.assistant247.net` → jobs
**auto-land on its board**. This is **already live per shop**:
- `netlify/functions/platform-email-intake.js` — resolves the shop by the address's slug, lands the job via
  the service key, idempotent per Message-ID, deduped by claim#.
- `netlify/functions/_lib/warranty-email.js` — the 3‑tier parser: AHS/Frontdoor XML, ServicePower/SquareTrade,
  and a **Claude fallback** that reads any dispatch format we've never seen (so onboarding a new warranty
  company needs zero code).
- Surfaced on `platform/owner.html` ("📥 Emailed jobs" card, shows the shop its intake address + a live feed).

**Spec work for Tier 1 = surface + document it in onboarding, not build it.** It's the "attach yourself this
afternoon" path and it covers every warranty company from day one.

### Tier 2 — API upgrade (per-shop Frontdoor grant)
The shop connects its AHS/Frontdoor **API credentials** in `platform/integrations.html` and gets:
- Real-time dispatch intake (no email parsing lag).
- **Status sync both ways** — the shop's techs' taps flow to AHS; AHS status changes flow to the shop's board.
- The inbound reactions (autho-gate on approved/denied, NCC → pay link, expedited/medical alert).
- Claim auto-file — **if** Frontdoor exposes a submission API (open question; see Gates).

This is the net-new build. It runs **entirely as the shop** via the per-tenant credential rails below.

## What already exists — REUSE, do not rebuild
The multi-tenant plumbing is ~80% there. Reuse these; do not duplicate:

| Capability | Reuse |
|---|---|
| Tier 1 job lander (warranty fields) | `platform-email-intake.js` `createWarrantyJob()` (slug→company, service-key insert, dedup by claim#, writes `warranty_company/claim_number/dispatch_id/service_window`; brand/model/serial → `unit.attributes`) + `email_intake` ledger (`docs/sql/044_email_intake.sql`). **`createWarrantyJob` is inline/private today — extract it (see build item 1).** |
| Per-shop encrypted creds | `tenant_integration` (vendor `ahs`/`frontdoor`, `docs/sql/011_tenant_integration.sql`), `_lib/tenant-creds.js` (envelope encryption — a per-shop DEK wrapped by the vault KEK; blast radius = one shop), `_lib/vendor-ctx.js` (AsyncLocalStorage), `_lib/tenant-vendor.js` `runAsTenant(companyId,'ahs',fn)` |
| Connect UI + live verify | `platform/integrations.html` (the AHS card already lists `client_id/api_username/api_password/vendor_id`) + `_lib/vendor-verify.js` `verifyAhs()` (real per-shop token mint) |
| Tenant-aware connector | `_lib/frontdoor.js` — already reads `vendorCtx.current('ahs')` before falling back to TN's vault. Every AHS call can run as the shop with no connector change. |
| The exact pattern to mirror | `_lib/servicepower-tenant.js` (`forCompany(companyId)` bound handle) + `platform-servicepower.js` (`do=status\|ping\|claimcheck`, gated by Supabase session Bearer OR admin-secret+company) |
| Inbound reactions | The legacy TN `netlify/functions/frontdoor-webhook.js` `applyInbound()` (status/notes/NCC + autho-gate + NCC pay-link + expedited alert) — port the logic, swapping TN Xano writes for platform Supabase service-key writes |

## What's missing — the Phase-1 build (all mirror existing patterns)
1. **`_lib/platform-warranty-db.js`** — extract `createWarrantyJob` + add a `applyDispatchUpdate` (status/note/ncc)
   so **both** the email intake and the API webhook land/update jobs identically, company-scoped via the service key.
2. **`_lib/frontdoor-tenant.js`** — a bound handle mirroring `servicepower-tenant.js` `forCompany(companyId)`:
   returns `{ statusPush, ping, submitClaim, … }` that each run inside `runAsTenant(companyId,'ahs',fn)` so every
   AHS call authenticates as that shop. Returns `null` when the shop hasn't connected API creds (callers skip cleanly).
3. **`platform-frontdoor-webhook.js`** — Tier‑2 inbound (Frontdoor → shop). Multi-tenant routing the proven way:
   the webhook URL is **slug-baked** (`?slug=‹shop›&k=‹per-shop token›`) exactly like the email-intake address and
   the call-brain tool URLs. Resolve company by slug → validate the per-shop token (stored in `tenant_integration.meta`)
   → land/update the job via `platform-warranty-db` + apply status/notes/ncc + the reactions (ported from TN). Dark
   per shop until the shop flips live.
4. **`platform-ahs.js`** — per-tenant outbound, mirroring `platform-servicepower.js`: `do=status_push` (tech tap →
   AHS as the shop via `frontdoor-tenant`), `do=ping` (verify auth as the shop), `do=claimcheck`. Wire the platform
   tech app's lifecycle taps (`platform/tech-job.html` Start/Complete/etc.) to call it — AHS jobs only.
5. **`platform-frontdoor-claims.js`** — per-shop claim auto-file, mirroring the TN money-loop scaffold
   (`_lib/frontdoor-claims.js` + `frontdoor-claims-submit.js`). Gated on the submission-API answer + the shop's code lists.
6. **Onboarding UX** (`platform/integrations.html` + `platform/owner.html`): the AHS card already connects creds — add
   (a) the shop's **slug-baked webhook URL** to hand Frontdoor, (b) a per-shop shadow→live toggle, (c) a plain
   "Tier 1 works now / Tier 2 needs Frontdoor to grant your shop API access" explainer. The Tier-1 email address is
   already on `owner.html`.

## Honest gates (do not hide these)
- **Tier 2 needs Frontdoor to grant EACH shop API access** (its own client ID) — the same multi-week approval TN
  went through (client ID enabled, dev team, sandbox → production). Onboarding is turnkey on our side, but we cannot
  skip Frontdoor's per-shop grant. **Tier 1 covers the shop meanwhile** — this is the whole reason for the two-tier design.
- Each shop's outbound webhook must be **pointed at its slug-baked URL by Frontdoor** — a per-shop config on their side.
- **Claim auto-file** is gated on whether a claims/estimate/invoice submission API exists at all (open question with
  Frontdoor's dev team) + the shop's official defect/repair/category **code lists**. If no submission API exists, the
  Plan B is portal browser-automation (log in as the shop, paste the already-assembled claim, submit) — brittle but
  the industry-standard way to automate a portal with no API.

## Build sequence
- **Phase 0 (now):** prove the full AHS round-trip on **TN's own account** (legacy `frontdoor-webhook.js` +
  `frontdoor-push-*` + the inbound reactions + claim scaffold). De-risks every payload shape before it's multiplied
  across shops.
- **Phase 1:** build items 1–4 + 6 = "Tier 2 status-sync both ways, per shop." Mostly assembly of the rails above.
- **Phase 2:** item 5 (claim auto-file per shop) — after the submission-API answer.
- **Phase 3:** generalize to the full **warranty layer** — ServicePower/SquareTrade already have
  `platform-servicepower.js`; add NSA and others → one board, every warranty company, both directions.

## Critical files
- **NEW:** `_lib/platform-warranty-db.js`, `_lib/frontdoor-tenant.js`, `netlify/functions/platform-frontdoor-webhook.js`,
  `netlify/functions/platform-ahs.js`, later `netlify/functions/platform-frontdoor-claims.js`.
- **EDIT:** `platform/integrations.html` (webhook URL + per-shop status), `platform/tech-job.html` (AHS lifecycle push),
  `platform/owner.html` (Tier 1/Tier 2 explainer).
- **REUSE (no rebuild):** `platform-email-intake.js`, `_lib/warranty-email.js`, `_lib/tenant-creds.js`,
  `_lib/vendor-ctx.js`, `_lib/tenant-vendor.js`, `_lib/frontdoor.js` (tenant-aware), `_lib/vendor-verify.js`,
  `servicepower-tenant.js` + `platform-servicepower.js` (pattern), legacy `frontdoor-webhook.js` reactions.

## Verification (when Phase 1 is built)
- **Tier 1:** synthetic AHS email → a demo shop's intake → job lands on THAT shop's board only (already proven for demo).
- **Tier 2 inbound:** `platform-frontdoor-webhook?slug=demo&k=…` + a synthetic dispatch (dark) → job lands/updates on
  the demo board, RLS-scoped; wrong slug/token → rejected.
- **Tier 2 outbound:** connect bogus AHS creds on a demo tenant via `integrations.html` → `verifyAhs` returns a clean
  error; `platform-ahs?do=ping` → authenticates as the shop (bogus → not-authenticated, no crash); `do=status_push`
  shadow → would-push as the shop.
- **Isolation:** shop A's creds/webhook can never touch shop B (envelope-encrypted DEK per shop + slug scoping).

---
_Changelog: 2026‑08‑31 — initial spec (Teddy)._
