# TN Appliance Exchange LLC — Information Security Policy

**Owner:** James "Teddy" Pivacek (Owner)
**Version:** 1.0 · **Effective date:** 2026-07-02
**Review cadence:** reviewed at least every **6 months** (next review: 2027-01-02)

> This policy describes the security controls TN Appliance Exchange LLC applies to protect **Amazon Information** (data obtained through Amazon APIs), customer personal information, and credentials. It supports our attestations under the Amazon Services API Acceptable Use Policy and Data Protection Policy.

---

## 1. Scope

Applies to all TN Appliance systems, cloud services, company devices, and anyone with access to in-scope data (Owner, office staff, and any contractor granted access).

## 2. Data classification

- **Amazon Information** — data retrieved via Amazon APIs (order/shipment/inventory/account). Treated as confidential; retained only as long as needed for the operation it supports.
- **Customer PII** — names, addresses, phone numbers, job/appliance records.
- **Secrets** — API keys, tokens, passwords, payment references.

We collect and retain only the minimum data needed to operate, and we do **not** sell or share Amazon Information with third parties.

## 3. Access control (least privilege)

- Access to in-scope data is **restricted by job function** — a person is granted only the access their role requires (e.g., the office operator can list/ship inventory but cannot access banking/payment settings; techs access only their own jobs).
- Administrative and owner-level access (payments, secrets, account settings) is limited to the Owner.
- Application surfaces enforce role separation (office one-login, tech one-login, read-only office views for techs).
- Access is reviewed when a person's role changes or they leave.

## 4. Authentication and passwords

- **Multi-Factor Authentication (MFA) is required** on every account that can reach in-scope data or infrastructure (Amazon, Google/email, Xano, Netlify, Supabase, Cloudflare, Stripe, Telnyx, Vapi, GitHub).
- Account passwords meet a **minimum of 12 characters and include special characters.**
- Passwords are **unique per service** and stored in a password manager — never reused, never shared in plaintext.
- Passwords are **rotated at least annually** (maximum 365-day lifetime), and immediately upon any suspected exposure.

## 5. Credential and secret management

- Secrets (API keys, tokens, payment references) are stored in our **runtime secret vault** — never hardcoded into application code, never committed to source control, never posted in chat/email.
- Source repositories are private; automated checks and review guard against committed secrets.
- Any exposed secret is **rotated immediately** under the Incident Response Plan.

## 6. Network and endpoint security

Our application runs on managed cloud infrastructure. The following network security controls are implemented through our infrastructure providers and endpoint configuration:

- **Firewalls** — provided at the platform/network layer by our cloud providers (AWS, Netlify, Cloudflare, Xano, Supabase); host firewalls enabled on company endpoint devices.
- **Intrusion detection/prevention (IDS/IPS)** — provided by our cloud providers as part of their managed platform security.
- **Anti-virus / anti-malware** — enabled on all company endpoint devices (macOS built-in firewall and XProtect/Gatekeeper malware protection kept enabled and current); provider-level malware scanning on cloud infrastructure.
- **Network segmentation** — enforced by provider architecture; production data, backups, and media are held in separate managed services with independent access controls, and are not on a flat internal network.

Company devices are kept up to date with security patches, use full-disk encryption where available, and are screen-locked.

## 7. Encryption

- **In transit:** all traffic to our systems and to Amazon APIs uses TLS/HTTPS.
- **At rest:** data is encrypted at rest by our cloud providers (database, backups, object storage).

## 8. Vendors / subprocessors

We rely on established providers (AWS, Netlify, Xano, Supabase, Cloudflare, Stripe) whose platforms carry industry security certifications. Vendor security posture is considered before granting access to in-scope data.

## 9. Incident response

Security incidents are handled per the **Incident Response Plan** (`incident-response-plan.md`), which includes notifying **security@amazon.com within 24 hours** of any incident involving Amazon Information.

## 10. Policy maintenance

This policy is **reviewed at least every 6 months** and after significant infrastructure changes. Review history is logged below.

---

### Review history
| Date | Reviewer | Notes |
|---|---|---|
| 2026-07-02 | Teddy Pivacek | Policy created and adopted (v1.0). |
