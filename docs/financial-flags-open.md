# Open financial items — pending Alyse review

Running list of financial-system items that need a human review (Alyse) before they're safe to fully automate. Update as items resolve; do not delete — convert to a "resolved" note with the date so the audit trail survives.

Last updated: 2026-05-24.

---

## 1. Commission rates encoded in `colony-loop/rules/commission_rules.json`

| tech_id | Name  | Rate                    |
|---------|-------|-------------------------|
| 1       | Teddy | 100% (owner)            |
| 2       | Jimmy | **45%**                 |
| 3       | Andre | **40%**                 |
| 4       | Lee   | **50%**                 |
| 5       | Billy | **40%**                 |
| 6       | John  | **40%**                 |
| (other) | —     | default 50%             |

**Why this needs review:** these rates were entered from Teddy's verbal direction on 2026-05-24. They drive `PAYROLL_CALCULATOR` agent output. Alyse should sanity-check that every tech's rate matches what their actual employment/contractor agreement says, and that the "default 50% for unlisted" doesn't conflict with any existing handshake deal.

**Action for Alyse:** confirm rates per tech against signed agreements. If anything is wrong, edit `colony-loop/rules/commission_rules.json` — change takes effect on next agent run (file is read every invocation; no restart needed).

---

## 2. `tech_earnings.commission_earned` is always $0

Per `docs/handoff-2026-05-22-end-of-day.md` open issue #3: the column is stubbed-zero on row write. The real commission values would come from:

- **Self-pay jobs:** the Stripe webhook flow (`stripe_checkout_session_completed`).
- **Warranty jobs:** the remittance-match flow against `warranty_vendor_accounts`.

**Neither flow writes to `commission_earned` today.** The colony-loop `PAYROLL_CALCULATOR` agent works around this by computing commissions directly from job rows + the rates JSON above — but any other consumer of `tech_earnings.commission_earned` (the financial dashboard, the `LEDGER_TASK_ENABLED` cron when it's flipped on) will see $0.

**Action for Alyse:** decide whether (a) to fix the upstream writes so `commission_earned` is real, or (b) to drop the column entirely and let the colony-loop's runtime calc be the source of truth.

---

## 3. `LEDGER_TASK_ENABLED` is unset (= false)

Per `docs/automation-inventory-2026-05-20.md` and CLAUDE.md feature-flag inventory. The `compute_tech_performance_ledger` cron is built but dormant.

**Why this is open:** flipping it on while `commission_earned` is broken (item 2) means the ledger rolls up zeros and overwrites whatever historical state exists.

**Action for Alyse:** confirm we should NOT flip this on until item 2 is fixed.

---

## 4. Stripe live secret rotation pending

Per `docs/security-cleanup-2026-05-20.md` and `docs/customer-automation-inventory-2026-05-20.md` Landmine 10. On 2026-05-20 the live Stripe secret was briefly exposed as a Netlify env-variable **name** (the secret value was in the name field). The bad env var was deleted, but **the key itself has not been rotated** at Stripe.

**Why this matters financially:** if the leaked-name event was indexed/captured by anything, the live key could be used to charge cards or refund without authorization until rotated.

**Action for Alyse / Teddy:** rotate the Stripe live key at dashboard.stripe.com → Developers → API keys, then update `STRIPE_SECRET_KEY` in Netlify env. Verify a test webhook still fires after rotation.

---

## 5. `warranty_vendor_accounts.active = false` per-row defaults

Per `docs/financial-system-design-2026-05-15.md:97,265,370`. When a remittance arrives from an unknown warranty vendor, the parser auto-creates a `warranty_vendor_accounts` row with `active=false` and (per design) SMSes the owner to review.

**Status of the SMS escalation:** unverified. The "SMS owner on auto-create" path may not be wired end-to-end. We may have inactive rows sitting in the table that haven't been triaged.

**Action for Alyse:** pull `SELECT * FROM warranty_vendor_accounts WHERE active=false` via the Xano metadata API. For each row, decide active vs. discard. Activate via the financial dashboard's vendor-activate button (designed in `financial-system-design-2026-05-15.md`) — or directly via PUT `/api:meta/workspace/1/table/{warranty_vendor_accounts_id}/content/{row_id}` with `{active: true}`.

---

## 6. Payout-batch trigger UI missing

Per `docs/handoff-2026-05-22-end-of-day.md` workflow gap #10. The `payout_batch_POST.xs` endpoint exists and is callable (smoke-tested 2026-05-22), but no dashboard button has been wired to fire it. Teddy currently has to `curl` it manually with `{dry_run: true}` or `{dry_run: false}`.

**Action for Alyse:** decide if you want a "Run Payout Batch" button on the financial dashboard. If yes, this becomes a small front-end task (one button on `financial-dashboard.html` that POSTs the endpoint). If no, document the manual curl as the operational procedure.

---

## 7. Pre-appointment upsell SMS not designed

Per `docs/handoff-2026-05-22-end-of-day.md` workflow gap #9. The idea is: between booking and the tech arriving, text the customer about service-plan / parts-bundle / extra-appliance options. **No design exists yet.** No estimated revenue impact attached to it.

**Action for Alyse:** is this worth designing? If yes, what's the offer structure (% off labor with plan? bundle pricing?), and what would the SMS look like? If no, close this item.

---

## Resolved (recent)

- (none yet)
