# TN Appliance Exchange LLC — Incident Response Plan

**Owner:** James "Teddy" Pivacek (Owner / Incident Response Lead)
**Version:** 1.0 · **Effective date:** 2026-07-02
**Review cadence:** reviewed and updated at least every **6 months** (next review: 2027-01-02)

> This plan defines how TN Appliance Exchange LLC ("TN Appliance," "we") detects, responds to, and reports security incidents — including any incident involving **Amazon Information** (data obtained through Amazon APIs) or customer personal information. It exists to satisfy the Amazon Services API Acceptable Use Policy and Data Protection Policy and to protect our customers and partners.

---

## 1. Scope

This plan covers any confirmed or suspected **security incident** affecting:
- **Amazon Information** — any data retrieved through Amazon APIs (order, shipment, inventory, or account data).
- **Customer personal information** — names, addresses, phone numbers, appliance/job records.
- **Credentials and secrets** — API keys, tokens, passwords, payment references.
- The systems that store or process the above: Xano (application database), Netlify (functions/hosting), Supabase (backups/archive), AWS S3 / Cloudflare (media), and company endpoint devices.

## 2. What counts as a security incident

A security incident is any event that compromises, or is reasonably suspected to compromise, the confidentiality, integrity, or availability of the data or systems in scope. Examples:
- Unauthorized access to an account, database, or secret.
- A leaked or exposed credential (key committed to a public repo, shared password, phishing).
- Malware on a company device.
- Unexpected data export, deletion, or modification.
- A vendor breach affecting our data.

## 3. Roles and responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **Incident Response Lead** | Teddy Pivacek (Owner) | Owns the response, makes containment/notification decisions, is the point of contact for Amazon and other partners. |
| **Technical Lead** | Owner / assigned engineer | Investigates, contains, remediates; rotates affected credentials; preserves logs. |
| **Communications** | Owner | Notifies affected customers, partners, and regulators as required. |
| **Backup contact** | Office manager (Danielle) | Covers detection/escalation if the Owner is unreachable; escalates to the Owner immediately. |

## 4. Detection and escalation

Incidents may be detected via: automated alerts (SMS breaker, healthcheck, watchers), vendor notifications, a partner/Amazon report, or a person noticing something wrong.

**Anyone who detects or suspects an incident escalates to the Incident Response Lead immediately** (call/text Teddy). Do not wait.

## 5. Response procedure

1. **Triage (0–1 hr):** Confirm whether it is a real incident and its scope. Record what was detected, when, and by whom.
2. **Contain (within hours):** Stop the bleeding — disable the affected account/key, revoke tokens, take the affected system offline if needed. **Rotate any exposed credential immediately** (via the secret vault).
3. **Assess:** Determine what data was affected, whether Amazon Information or customer PII was involved, and how.
4. **Notify (see §6).**
5. **Remediate:** Fix the root cause; restore from clean backups if needed.
6. **Post-incident review (see §7).**

## 6. Notification requirements

- **Amazon:** If the incident involves **Amazon Information**, we notify **security@amazon.com within 24 hours of detection**, and cooperate with any follow-up. This is a firm requirement of this plan.
- **Affected customers:** Notified without undue delay where their personal information was involved, consistent with applicable law.
- **Regulators / card networks:** Notified as required by applicable law and by Stripe/PCI obligations for any payment-data incident.
- **Vendors:** Relevant providers (Xano, Netlify, etc.) engaged as needed.

## 7. Post-incident review

Within 2 weeks of closing an incident, the Incident Response Lead documents: what happened, timeline, root cause, what was done, and **what we changed to prevent recurrence.** Action items are tracked to completion.

## 8. Plan maintenance

- This plan is **reviewed at least every 6 months** and after any significant incident or infrastructure change.
- Reviews confirm roles/contacts are current, notification paths work, and lessons learned are incorporated.
- Review history is logged at the bottom of this document.

## 9. Key contacts

- **Incident Response Lead:** Teddy Pivacek (Owner) — internal contact on file.
- **Amazon security reporting:** security@amazon.com (within 24 hours).
- **Backup:** Danielle (Office Manager).

---

### Review history
| Date | Reviewer | Notes |
|---|---|---|
| 2026-07-02 | Teddy Pivacek | Plan created and adopted (v1.0). |
