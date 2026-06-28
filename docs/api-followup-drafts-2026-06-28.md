# API follow-up nudges — drafts (2026-06-28)

Two ready-to-send follow-ups for the two slowest, externally-gated APIs.
Send Amazon FROM tnappliance@gmail.com (the SPP/buyer login); send Frontdoor
FROM tnappliancerepair@gmail.com (the contractor-portal login). No secrets in
either body — only paste the bracketed IDs from the portal. Never include the cell.

---

## 1) Amazon Business Ordering API — production access

**To:** (reply on the existing Amazon Business / SPP support thread, or SPP support)
**From:** tnappliance@gmail.com
**Subject:** Follow-up — Amazon Business Ordering API, production authorization (TN Appliance Exchange)

Hi,

Following up on our Amazon Business Ordering API integration. We're an appliance-repair company (TN Appliance Exchange LLC) using the Ordering API to drop-ship repair parts directly to our customers.

Where we are on our side:
- Solution Provider Portal account created (login: tnappliance@gmail.com; Amazon Business buyer account A-22A7N0U5ZWQ5H)
- Sandbox app built and authenticating successfully (LWA client-credentials — access token acquired)
- Ordering API tested against the sandbox endpoint; payload schema validated per your docs

We're ready to move to production and just need the production app authorization. Could you let us know:
1. What's required from us to authorize the app for production ordering?
2. The Group ID / buying group, authorized buyer email, and payment method reference to use for production orders.

We submitted our initial request on June 20. We're ready to go live the moment the production app is authorized — anything else you need from us, just say the word.

Thank you,
James "Teddy" Pivacek
Owner, TN Appliance Exchange LLC
866-268-0111 · tnappliance@gmail.com

---

## 2) Frontdoor / AHS — Dispatch Connector: authorize sandbox key + production access

**To:** partnerapiadmin@frontdoorhome.com  (cc your BD rep "Ben" if you have his address)
**From:** tnappliancerepair@gmail.com
**Subject:** Follow-up — Dispatch Connector API: authorize sandbox key + production access (TN Appliance Exchange, AHS vendor)

Hi Partner API Admin (and Ben, if appropriate),

Following up on our Dispatch Connector API integration. We're an active AHS/Frontdoor service contractor (TN Appliance Exchange LLC). Our goal is to push job status and notes directly into the contractor portal via the API so our team stops updating the portal by hand.

Where we are:
- Developer Portal access confirmed; sandbox API key generated
- Authentication verified — we successfully mint a JWT against the sandbox token endpoint
- Our integration matches the published Dispatch Status Update spec (POST /dispatch-connector/v1/webhook)

The one blocker: calling the dispatch-connector endpoint with our sandbox key returns **403 Forbidden** — it appears the sandbox key isn't yet authorized/provisioned for the dispatch-connector endpoint on your side.

Two requests:
1. **Authorize our sandbox key for the dispatch-connector endpoint** so we can finish sandbox testing (this should clear the 403).
2. **Start us on production access** so we can go live once sandbox passes.

Account details for lookup:
- Contractor/portal email: tnappliancerepair@gmail.com
- Organization: TN Appliance Exchange LLC
- Vendor ID: [paste vendor ID]
- Sandbox Client ID / API username: [paste from Developer Portal]
- Environment: sandbox

We're a high-volume AHS contractor and this will meaningfully speed up our status updates. Please let me know what else you need to move this forward.

Thank you,
James "Teddy" Pivacek
Owner, TN Appliance Exchange LLC
866-268-0111 · tnappliancerepair@gmail.com
