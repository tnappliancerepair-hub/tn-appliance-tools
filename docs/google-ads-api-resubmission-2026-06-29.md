# Google Ads API — Basic Access RESUBMISSION (case 6-3335000041044)

> ✅ **ALREADY SENT by Teddy — Sun Jun 28, 9:44 AM.** His reply on the thread covers the
> business model, use case, and direct content links. DO NOT resend (a duplicate muddies
> the case). The homepage flip (/ → index.html, 6/29) complements it so the bare domain
> also shows content. Now waiting on Google's next response. Draft below kept for reference.


**Bounce reason (28 Jun):** reviewer hit `/` and saw the chat app, not business
content ("your company website does not have content related to your application").
**Fixed:** `/` now serves `index.html` — the full appliance-repair homepage
(services, areas, pricing, reviews, LocalBusiness schema) with the chat still on it.
**Their warning:** do NOT resubmit the same answers. Use the fresh write-up below.

> ⚠️ Before resubmitting, set the **developer contact email** to a role/distribution
> address (their note), e.g. `google-ads-api@tnapplianceexchange.net` or `info@…`,
> not a personal inbox.

---

## Paste into "How will you use the Google Ads API?" (the main field)

TN Appliance Exchange LLC is a family-owned appliance **repair** company serving
Middle Tennessee and Louisiana (Nashville, Murfreesboro, Franklin, Clarksville,
New Orleans, Baton Rouge, Hammond and surrounding areas). We diagnose and repair
refrigerators, washers, dryers, dishwashers, and ovens/ranges for homeowners. Our
website (https://tnapplianceexchange.net) shows our services, service areas,
transparent repair pricing, our 4-option Technician Decision Report process,
customer reviews, and a booking assistant.

**This is an INTERNAL tool for managing our OWN single Google Ads account**
(manager account "ANT-Manager", MCC 160-509-9162). We are not building software
for other advertisers and we do not resell or provide API access to third parties.
We will use the API only against our own account, for three things:

1. **Reporting & analytics.** Pull campaign, ad group, keyword, and search-term
   performance (impressions, clicks, cost, conversions, cost-per-booked-job) with
   GoogleAdsService.Search (GAQL) to monitor return on ad spend daily.

2. **Campaign management.** Programmatically adjust daily budgets and bids, pause
   underperforming keywords and campaigns, and add negative keywords, so our spend
   tracks our real-time repair capacity and profitability by service area.

3. **Conversion tracking.** Upload offline conversions (a booked/completed repair
   and its ticket value) via the conversion upload service so the account optimizes
   toward profitable booked jobs rather than raw clicks.

**Scope:** a small number of Search campaigns targeting "appliance repair" intent
across our Tennessee and Louisiana service areas. Single advertiser (ourselves),
governed by a profit ceiling with manual kill switches and human review.

## Supporting answers (if the form asks separately)
- **Developing for:** our own Google Ads account only (not on behalf of others).
- **Tool type:** internal reporting + campaign management + conversion upload.
- **Company website:** https://tnapplianceexchange.net (live, content-complete).
- **API services used:** GoogleAdsService (reporting/GAQL), Campaign/AdGroup/Budget
  mutate services, ConversionUploadService.
- **Will you make calls on behalf of other Google Ads accounts?** No.

---

## After approval
- Revert the homepage if desired: uncomment the `/ -> /appliance-ai.html 200!`
  line in `_redirects` (one line) to restore the chat-first front door.
- Then wire the conversational, profit-governed Search autopilot (OAuth + connector
  already built: `google-ads-oauth-*`, `_lib/google-ads.js`, `google-ads-test`).
