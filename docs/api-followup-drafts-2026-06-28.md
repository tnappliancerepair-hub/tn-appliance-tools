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

## 1b) Google Ads API — reply to the "incomplete application" (DO NOT resubmit the form)

**Reply to:** ads-api-compliance@google.com (reply ON the existing thread [6-3335000041044])
**From:** tnappliancerepair@gmail.com (the address that applied)
**Subject:** Re: [6-3335000041044] Your Google Ads API Basic Access Application

Hello Google Ads API Compliance team,

Thank you for the review. Here is a detailed description of our business model and our intended use of the Google Ads API, along with working content pages on our website.

BUSINESS MODEL
TN Appliance Exchange LLC is a residential appliance-repair company serving Middle Tennessee and southeast Louisiana. We repair refrigerators, washers, dryers, dishwashers, and ranges/ovens for both home-warranty customers (American Home Shield/Frontdoor, SquareTrade, etc.) and cash/self-pay homeowners. Website: https://tnapplianceexchange.net

Our homepage routes first-time visitors into a customer service-request flow, so here are direct links to our company-information content for your review:
- Company & services: https://tnapplianceexchange.net/index.html
- Dryer repair: https://tnapplianceexchange.net/dryer-repair.html
- Dishwasher repair: https://tnapplianceexchange.net/dishwasher-repair.html
- Oven/range repair: https://tnapplianceexchange.net/oven-repair.html
- Privacy policy: https://tnapplianceexchange.net/privacy.html
- Terms: https://tnapplianceexchange.net/app-terms.html

USE CASE OF THE GOOGLE ADS API
We will use the API solely to manage our OWN single Google Ads account. We are a first-party advertiser — we are not building a tool for, and will not manage ads on behalf of, any third-party advertisers. Specifically we will:
- Pull our campaign/ad-group/keyword performance (cost, clicks, conversions) for internal reporting.
- Adjust our own budgets and bids, and pause underperforming campaigns/keywords.
- Add negative keywords to reduce wasted spend.
- Feed our booked-job conversion values back in to optimize spend by service type and geography.
This is an internal optimization tool for our own advertising account only.

Developer contact: [optional — a role-based address like ads-api@tnapplianceexchange.net if you have domain email; otherwise leave the current contact]

Please let me know if you need anything further.

Thank you,
James "Teddy" Pivacek
Owner, TN Appliance Exchange LLC
866-268-0111

> Belt-and-suspenders: because the reviewer judged the ROOT URL (which redirects to the
> chat intake), strongly consider TEMPORARILY pointing `/` → the content homepage during the
> review (one-line `_redirects` change, flip back the instant they approve). Claude can do it.

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

## 3) Google Business Profile API — Basic Access (review replies) — NUDGE case 4-9470000004382

**Reply on:** the existing case thread for **4-9470000004382** (search the Google account inbox for the case-confirmation email and reply to it). If you can't find it, re-submit at support.google.com/business/contact/api_default and reference the case number.
**From:** the Google account that manages the TN Appliance Exchange Business Profile.
**Subject:** Follow-up — Business Profile API Basic Access, case 4-9470000004382 (TN Appliance Exchange LLC)

Hello Business Profile API team,

I'm following up on my Basic Access application, **case 4-9470000004382**. I'd like to check the status and confirm there's nothing else needed from my side.

About us:
- TN Appliance Exchange LLC — an active appliance-repair business in the Nashville, TN area (and Louisiana).
- We manage one verified Google Business Profile with roughly **1,100 customer reviews**.
- Google Cloud project: project-fb170b47-a89e-4176-9d1 (project number 1340849724014), with the Business Profile APIs enabled.

What we want to do with the API (our use case):
1. **Read our reviews and post timely, personalized replies** — we reply to every customer by name and reference the specific repair. With ~1,100 reviews and steady new ones, doing this promptly by hand is the bottleneck; the API lets us respond faster and more consistently.
2. Keep our business information (hours, services, posts) accurate programmatically.

We only manage **our own** Business Profile — this is for first-party use on our own location, not a third-party management platform.

Could you let me know:
1. The current status of case 4-9470000004382?
2. Anything else you need from us to approve Basic Access?

Thank you for your time,
James "Teddy" Pivacek
Owner, TN Appliance Exchange LLC
866-268-0111
