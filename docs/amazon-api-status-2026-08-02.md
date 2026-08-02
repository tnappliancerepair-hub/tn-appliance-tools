# Amazon API status — where both threads stand (2026-08-02)

Snapshot so the next session (or Teddy in a week) picks up cleanly. **Two
DIFFERENT Amazon programs are in flight — easy to conflate:**

| Program | What it does for us | Status |
|---|---|---|
| **SP-API (Selling Partner)** | Sell our OWN Amazon listings → Brand Referral Bonus (the "Amazon-equivalent" tier as our own listings) | 🟡 Blocked on Amazon account-linking — support reply sent |
| **Business Ordering API** | BUY parts through our Amazon Business account, drop-ship to the customer's/tech's door | 🟡 Under review by Amazon — our part done |

Both are **waiting on Amazon** as of 2026-08-02. Nothing on our side blocks the
business meanwhile: the **Amazon Associates** fallback link is live and earning
on every page (`ant-amazon.js`, store id `tnappliance-20`).

---

## 1) SP-API (Selling Partner) — selling our own listings

**Status: developer profile APPROVED, but can't authorize — Amazon-side account-linking issue. Support reply SENT 2026-08-02.**

**The story:**
- Identity verification update — Jul 2 (Amazon Solution Provider Services Team).
- **SP-API Developer Profile Created / APPROVED — Jul 3** (`dev-reg-vetting@amazon.com`): "access to SP-API has been APPROVED."
- Self-authorization failed → opened **support case 21424102471** (`spapi-dev-us@amazon.com`, agent **Nicole**). She clarified the SPP developer account and Seller Central are separate by design and must be linked via the account switcher / authorize flow.

**What we tried (all dead-ended on Amazon's console):**
- **Manage Your Apps** (`sellercentral.amazon.com/apps/manage`) — spins forever, never loads the app list (normal browser AND clean Incognito).
- **Developer Profile** (`sellercentral.amazon.com/developer/register`) — returns **"Access Required — you don't have the right permissions to access this page."**
- Account switcher shows the **correct single login** (TN Appliance Exchange LLC) with contexts: *Amazon Pay (Production)*, *Amazon Pay (Sandbox View)*, *Login with Amazon*, *Mexico*, *United States*. Correct login confirmed — not a wrong-account problem.
- **"Select an account"** authorization page → **"You are not currently authorized to access any accounts."**
  - **CID: A3J1GWCZG35O9C**
  - **RID: A16I5Q2S4P61K7D189HQ**

**Root cause:** the developer identity has **no seller account linked to it** to authorize against (SPP ≠ Seller Central, not linked). Only Amazon can link them server-side.

**Action taken 2026-08-02:** replied to case 21424102471 (to `spapi-dev-us@amazon.com`) with the symptoms + CID/RID, asking Amazon to (1) link the seller account to the dev profile, and (2) grant access or send a direct authorization link. **Confirmed sent.**

**⏭️ When Amazon replies + links it:**
1. Complete the self-authorization in Seller Central (Develop Apps → your app → **Authorize**) → it produces the LWA **refresh token** (`Atzr|…`).
2. Also grab the app's **LWA Client ID + Client Secret**.
3. Vault (via `admin-secrets.html`, NEVER in chat):
   - `SPAPI_REFRESH_TOKEN`
   - `SPAPI_CLIENT_ID`
   - `SPAPI_CLIENT_SECRET`
   - *(optional)* `AMAZON_SELLER_ID`; US marketplace `ATVPDKIKX0DER` is the connector default.
4. **Verify:** hit `sp-api-test?secret=<VAPI_ADMIN_SECRET>` — it scans the vault for the cred trio and calls getMarketplaceParticipations to confirm auth + marketplace visibility.
5. Then wire listings/orders. **Connector already built:** `netlify/functions/_lib/spapi.js` (reads the `SPAPI_*` trio first) + `sp-api-test.js`.

**Prereq reminder:** the seller account must be on a **Professional** selling plan (Individual can't use SP-API). Private apps stay in "draft" status — normal.

---

## 2) Amazon Business Ordering API — drop-ship parts to the customer

**Status: UNDER REVIEW by Amazon. Our side complete — no action needed.**

- Reviewer: **Prashanth Chintamaduka** (`chintamp@amazon.com`) + `ab-api-access-approvals@amazon.com`.
- Jul 28: Prashanth confirmed the request is **"currently under review"** and asked whether we have an existing Amazon Business contact (Account Manager / Solutions Consultant / Sales rep).
- **Teddy answered Jul 28** (newest message in thread): no dedicated contact, account set up self-serve, open to working with a rep if recommended. → **Ball is in Amazon's court.**

**⏭️ When production access is granted:**
- Vault `AMAZON_BUSINESS_GROUP_ID`, `AMAZON_BUSINESS_BUYER_EMAIL`, `AMAZON_BUSINESS_PAYMENT_REF` + flip `AMAZON_BUSINESS_ENV=production`.
- Connector already built: `netlify/functions/_lib/amazon-business.js` (LWA creds: `AMAZON_LWA_CLIENT_ID/_SECRET/_REFRESH_TOKEN`; sandbox app already exists). `amazon-business-order.js` = the auto-placer scaffold.

---

## Hands-off monitoring
`netlify/functions/amazon-api-watch.js` (scheduled) scans all connected inboxes
and texts the owner the moment Nicole/spapi-dev-us or Prashanth replies — no
inbox babysitting needed. Manual re-sweep anytime via `gmail-search?secret=&q=`.

## Related (context, not blocking)
- **Amazon Associates** — LIVE (`tnappliance-20`), fallback "get the part on Amazon" link on all public pages via `ant-amazon.js` (mode `associates`). Flips to Brand Referral Bonus later once SP-API listings exist.
- **ERP (Exact Replacement Parts)** — distributor registration submitted Jul 30 (Jotform confirmation). Aftermarket source; when it lands, Amazon becomes the true *fallback*, ERP the default aftermarket. Watch for their credentials/approval reply.

## Contacts / IDs (diagnostic, not secrets)
- SP-API support case: **21424102471** · `spapi-dev-us@amazon.com` (Nicole)
- SP-API "select an account" — CID **A3J1GWCZG35O9C**, RID **A16I5Q2S4P61K7D189HQ**
- Business Ordering API: **chintamp@amazon.com** (Prashanth) · `ab-api-access-approvals@amazon.com`
- Business: TN Appliance Exchange LLC · Seller: TN Appliance (US) · phone 615-280-2949 · emails tnappliance@gmail.com / tnappliancerepair@gmail.com
