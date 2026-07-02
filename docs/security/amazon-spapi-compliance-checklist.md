# Amazon SP-API — Compliance Checklist & Reapply Guide

**Purpose:** Amazon denied our SP-API Developer Profile (2026-07-02) on four security controls we answered "No" to. This file makes each control genuinely true, then re-submits truthfully. **We do NOT lie on the reapply — we implement the controls (they're good hygiene anyway), then answer "Yes" honestly.**

> Reapply = submit a **NEW case** (do NOT reopen the old one) with updated Developer Profile responses: `https://sellercentral.amazon.com/developer/register`

---

## The four controls Amazon flagged → how each is now satisfied

| # | Amazon's question | Answer after this work | Where it's satisfied |
|---|---|---|---|
| 1 | Does your IR plan report incidents to **security@amazon.com within 24 hrs**? | **Yes** | `incident-response-plan.md` §6 |
| 2 | Firewalls, **IDS/IPS**, anti-malware, **network segmentation**? | **Yes** | `information-security-policy.md` §6 (provided by cloud providers + endpoint config) |
| 3 | **12-char + special + MFA + 365-day expiry + annual rotation** password policy? | **Yes** | `information-security-policy.md` §4 — **requires the operator actions below to be TRUE** |
| 4 | Formal **IR plan with defined roles, 6-month reviews, 24-hr notification**? | **Yes** | `incident-response-plan.md` §3, §6, §8 |

Controls #1, #2, #4 are satisfied by adopting the two policy documents (done — committed to the repo). Control #3 requires the operator actions below to actually be in place before you re-attest "Yes."

---

## ✅ Operator actions (only Teddy can do these — do before reapplying)

**Do these so control #3 and the endpoint parts of #2 are truthful, not aspirational:**

1. **Turn on MFA everywhere** — on every account that touches our data/infrastructure. Status + which authenticator holds the 2FA seed (record the method so it's recoverable):

   | Account | MFA status | Method |
   |---|---|---|
   | Amazon (Business buyer + Seller Central + Solution Provider Portal — one login) | ✅ Enabled | SMS to +1 615-485-5795 |
   | Google / Gmail (all 3 inboxes) | ✅ Enabled | Google 2-Step (prompt + phone) |
   | Xano (database) | ✅ Enabled | **Authy** |
   | Netlify | ☐ | — |
   | Supabase (backups) | ☐ | — |
   | GitHub (code) | ☐ | — |
   | Stripe | ☐ | — |
   | Cloudflare | ☐ | — |
   | Telnyx | ☐ | — |
   | Vapi | ☐ | — |

   > **Authenticator app of record: Authy** — prefer Authy for TOTP-based 2FA on the remaining services (Netlify, Supabase, GitHub, etc.) so all seeds live in one recoverable app.
2. **Adopt a password standard** — 12+ characters with special characters, unique per service, stored in a password manager (e.g., 1Password/Bitwarden). Update any that don't meet it. Set a yearly reminder to rotate.
3. **Confirm endpoint protection on company Macs** — System Settings → Network → **Firewall = On**; macOS keeps XProtect/Gatekeeper malware protection on automatically (leave it on, keep the OS updated).
4. **Adopt the two policies** — you (Owner) have reviewed and adopted `incident-response-plan.md` and `information-security-policy.md` as of their effective date. (The signed/adopted date in each doc is the record.)
5. **Set a 6-month review reminder** — calendar reminder to review both docs (next: 2027-01-02).

Once 1–4 are actually in place, the four attestations are **true.**

---

## Reapply steps (after operator actions are done)

1. Go to `https://sellercentral.amazon.com/developer/register` and start a **NEW** Developer Profile case (do not reopen the denied one).
2. Re-enter the profile (org info, business activity, roles — same as before).
3. **Security Controls — now answer truthfully:**
   1. Firewalls/IDS/anti-malware/segmentation → **Yes** (policy §6)
   2. Restrict access by job duties → **Yes**
   3. Encrypt in transit → **Yes**
   4. Formal IR plan (roles, 6-mo reviews, 24-hr) → **Yes** (IR plan)
   5. Report to security@amazon.com within 24 hrs → **Yes** (IR plan §6)
   6. 12-char + MFA + rotation → **Yes** (policy §4 + operator actions done)
   7. Credentials stored securely → **Yes** (policy §5)
4. Data-sharing boxes: "None…" (unchanged — we don't share Amazon info or pull it from non-Amazon sources).
5. Agree + submit.

If Amazon asks for evidence, we can share the two policy documents.

---

## Note: the SP-API denial does NOT block the near-term plan

- **Selling via FBA** (listing parts, FBA shipments, Danielle operating) runs through **Seller Central UI** — no SP-API needed. **Not blocked.**
- **Buyer / Amazon Business Ordering API** (drop-ship) is a **separate product** (`na.business-api.amazon.com`) authorized through the Amazon Business account — not the denied SP-API selling access.
- **SP-API** is only needed for **automation** (bulk-listing, Ant Brain auto-writing listings, programmatic sync). Reapply when we're ready to build that layer — this checklist is the on-ramp.
