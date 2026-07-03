# Amazon SP-API — Developer Profile security attestations + backing policy

Context: the first SP-API Developer Profile was **rejected 7/2/2026** ("not eligible
for SP-API access") because the Data Protection Policy security-controls attestations
weren't all answered Yes. This doc: (a) confirms each "Yes" is defensible for TN
Appliance Exchange, (b) gives the free-text answer, and (c) IS the Incident Response
Plan + security policy the "Yes" answers point to — keep it on file; Amazon can ask for it.

**Resubmit as a NEW case** (Amazon said do not reopen the rejected one). Portal:
`solutionproviderportal.amazon.com` → Developer Central → Developer Profile.

---

## ⚠️ First — know what this approval does and does NOT get you

SP-API (Selling Partner API) is the **SELLER** API. Approval lets us programmatically
**manage our own Amazon seller account** — list products, manage inventory, build/track
FBA shipments, and read orders buyers place on our listings. **That is the parts-RESALE
automation layer** (Track A of the resale plan).

It does **NOT** let us place purchase orders as a buyer. The "customer picks an
aftermarket part → auto-ship to their door" drop-ship goal is a **different** product
(Amazon **Business** Ordering API, `business-api.amazon.com`) — or, faster and with zero
approval, the authenticated browser bot we already have (`colony-loop/parts/amazon-order.js`,
same pattern as the live Marcone daemon). Don't wait on SP-API for drop-ship.

So finish + submit this SP-API profile to unlock **resale automation**; handle drop-ship
separately.

---

## Per-question — every answer is a defensible "Yes"

1. **Network security controls (firewalls, IDS/IPS, anti-virus/anti-malware, network segmentation)** → **Yes.**
   Business router/OS firewall on; endpoint anti-malware (Windows Defender / equivalent) on
   all machines; guest Wi-Fi segmented from business devices; cloud infra (Netlify, Xano)
   sits behind provider WAF/IPS. *Action to make it fully true:* confirm a separate guest
   Wi-Fi network and Defender (or equivalent) is active on the office/Mac machines.

2. **Restrict access to Amazon Information by job duty / business function** → **Yes.**
   Least-privilege by design: owner-only admin, office-password gate, tech PIN, and
   Danielle gets a **limited** Seller Central login (inventory/listings/FBA only — no
   banking/tax). Documented in the resale plan.

3. **Encrypt Amazon Information in transit** → **Yes.**
   All traffic is HTTPS/TLS end to end (Netlify, Xano, Amazon endpoints). No plaintext.

4. **Incident response plan with defined roles, 6-month reviews, 24-hour notification** → **Yes.**
   See the Incident Response Plan below — that IS the artifact.

5. **IR plan reports incidents involving Amazon Information to security@amazon.com within 24h** → **Yes.**
   Explicitly written into the plan below.

6. **Password policy: 12-char min + special chars, MFA, 365-day expiration, annual rotation** → **Yes.**
   *Action to make it fully true before you attest:* turn on **MFA** on the Amazon,
   Google, Netlify, and Xano logins (you already use Authy for AWS), and adopt the
   password rule in the policy below. Then this Yes is honest.

7. **Credentials stored securely — not in public repos, not shared, not hard-coded** → **Yes.**
   All secrets live in the runtime **vault** (Xano `app_config`), never in the git repo
   (`.gitignore` covers `.env`), never hard-coded in functions. This is a genuine strength.

8. **List all outside parties you share Amazon Information with + how** → free text:

> None. Amazon order and shipment data is used only within our own internal systems
> (our Xano backend and Netlify functions) to fulfill our own appliance-repair parts
> orders and manage our own seller inventory. We do not sell, share, transfer, or expose
> Amazon Information to any third party. Access is limited to the business owner and
> authorized staff under least-privilege logins.

---

## Incident Response Plan — TN Appliance Exchange LLC (the artifact behind Q4/Q5)

**Scope:** any security incident involving Amazon Information (SP-API data — orders,
inventory, shipment, buyer data) or the systems that store/process it (Xano, Netlify,
office/Mac machines, staff logins).

**Roles**
- **Incident Lead / Owner:** James "Teddy" Pivacek — decides, coordinates, notifies Amazon.
- **Technical responder:** the developer/admin of record (Xano/Netlify vault + infra).
- **Operations:** office staff — preserve evidence, stop using the affected login.

**Detection → response steps**
1. **Detect / report.** Anyone who suspects an incident tells the Incident Lead immediately
   (call/text). Vault, breaker, and health alerts also surface anomalies.
2. **Contain (within hours).** Rotate/disable affected credentials in the vault; revoke the
   affected LWA refresh token / app authorization; disable the compromised login; isolate
   the affected machine from the network.
3. **Notify Amazon within 24 hours.** Email **security@amazon.com** with the incident
   summary, data involved, and remediation. This is a hard 24-hour SLA from detection.
4. **Eradicate & recover.** Remove the cause (revoke keys, patch, re-image if needed),
   restore from the nightly off-site backup, and re-enable access with fresh credentials.
5. **Document & review.** Write a short post-incident record (what, when, impact, fix).

**Credential & access rules**
- Secrets in the vault only — never in the repo, never shared, never hard-coded.
- Least-privilege logins; MFA on all admin/seller/cloud accounts.
- Passwords: 12-char minimum with special characters, rotated at least annually
  (365-day expiration).

**Reviews:** this plan is reviewed at least every **6 months** (and after any incident)
by the Incident Lead.

**Amazon security contact:** security@amazon.com — 24-hour notification for any incident
involving Amazon Information.

_Last reviewed: 2026-07-03._

---

## Roles page — check ONLY these 5 (request the minimum; skip all Restricted)

App purpose: "manages only our own listings, pricing, inventory, and order tracking"
(the parts-resale/FBA automation). Over-requesting — especially any **(Restricted)** role
— is a top rejection reason and forces extra data-use/security review. Skip them all.

**✅ CHECK (non-restricted, exactly our use case):**
- **Product Listing** — create/manage our own listings (+A+ content). Core: listing the storage-unit parts.
- **Pricing** — set/automate our own prices.
- **Amazon Fulfillment** — FBA: ship to Amazon, Amazon ships to the customer. The whole plan is FBA.
- **Inventory and Order Tracking** — manage inventory + track our order status. Core.
- **Selling Partner Insights** — our own account/performance data. Low-risk, useful for what-sells decisions.

**❌ LEAVE UNCHECKED:**
- **Buyer Communication / Buyer Solicitation** — Amazon handles buyer contact on FBA; not needed.
- **Direct-to-Consumer Shipping (Restricted)** — merchant-fulfilled labels w/ buyer addresses = PII. FBA doesn't need it.
- **Tax Invoicing / Tax Remittance (Restricted)** — Amazon handles marketplace tax.
- **Professional Services (Restricted)** — install/assembly services; not us.
- **Account/Payment Initiation Service Provider** — EU Open Banking; irrelevant.
- **Amazon Logistics / Amazon Warehousing and Distribution (AWD)** — Buy-Shipping / bulk warehousing; not this scale.
- **Sustainability Certification, Finance and Accounting, Brand Analytics** — not needed for launch (can add later if we ever want SKU-level payout reconciliation via Finance/Brand Analytics).

**Use Cases free-text:**

> This app manages only our own Amazon seller account. We use it to create and manage
> our own product listings (new and tested-good used appliance-repair parts), set and
> update our own prices, send inventory to Fulfillment by Amazon (FBA) so Amazon fulfills
> orders to customers, and track our own inventory levels and order status for restocking
> and reconciliation. We do not access buyer PII, do not manage listings for any third
> party, and do not share Amazon Information outside our own internal systems.

