# Amazon Business Ordering API (#2) — the drop-ship push (2026-07-03)

Goal: place our OWN parts purchase orders programmatically on our **Amazon Business**
account → ship straight to the customer's door. This is the "customer picks the
aftermarket/Amazon-equivalent part → it auto-ships" half of the 4-option cash flow.

**This is a DIFFERENT product from SP-API.** SP-API (the profile we're submitting today)
is the seller/resale side. This one is `business-api.amazon.com` — the BUYER side.

## 🎯 THE RIGHT DOOR (found 2026-07-03 via Amazon's own docs)
Amazon runs TWO developer programs that BOTH live in the same Solution Provider
Portal — and we registered in the wrong one:
- **SP-API** (Selling Partner API) = SELLER side. What Teddy registered ("Build
  applications that use SP APIs" → the "TN-Appliance-Ordering" SP-API app). It can
  NEVER place a buyer order. This is why the sandbox sat for weeks doing nothing.
- **Amazon Business API** = BUYER side = **#2**. A SEPARATE onboarding that is NOT
  self-serve: it **starts with an email to the Amazon Business API team**, is
  human-reviewed, and **the team ASSIGNS the role** — you cannot self-select it.
  The role for placing orders is **`AmazonBusinessOrderPlacement`**.

Docs: `https://docs.business.amazon.com/docs/onboarding-overview` and
`https://docs.business.amazon.com/docs/ordering-api`.

### The onboarding path (in order)
1. **Add a developer user on the Amazon Business account.** business.amazon.com →
   Business Settings → **Add people** → add a generic email
   `TNApplianceExchange_abapi@…` (or tnappliance@gmail alias) with the **"Tech"**
   role → accept the invite.
2. **Send the onboarding request email** to **`ab-api-access-approvals@amazon.com`**
   (confirmed on the onboarding-overview page 2026-07-03) with the required fields
   (below), requesting the **Ordering API**. THIS EMAIL IS THE GATE — Amazon reviews it,
   then emails registration instructions and ASSIGNS the role (you cannot self-select).
   Amazon Business ID (directID): **A22ATN0J52WQXH**.
3. Amazon reviews (1–5 weeks) → provisions you → you finish the **developer profile
   in SPP** with **identity verification** (gov photo ID + proof of address + a short
   video call with an Amazon associate). The team **assigns** the OrderPlacement role.
4. **Account-side setup:** create a **group** in Business Settings → generate the
   **group identifier** → set **order safeguards** → add a **payment method** → add
   **users** to the group → switch **test mode → active**.
5. Then our connector plugs in: LWA refresh token + `GROUP_ID` + `BUYER_EMAIL` +
   `PAYMENT_REF` → flip `AMAZON_BUSINESS_ENV=production` → live.

### The request email — required fields (send verbatim)
- First name: James "Teddy" · Last name: Pivacek
- Job title: Owner
- Work email: (the `_abapi` developer email, or tnappliance@gmail.com)
- Phone: 866-268-0111
- Organisation name: TN Appliance Exchange LLC
- Postal code: 37013
- Industry: Appliance repair services
- Number of employees: 6
- Intended use case: "We are a residential appliance-repair company. We will use the
  Amazon Business Ordering API to programmatically place our OWN procurement orders —
  ordering repair parts on our own Amazon Business account and drop-shipping them
  directly to our repair customers' addresses. We are a first-party buyer using our
  own account only; we are not building a tool for any third party."
- Specific APIs you want to access: **Ordering API** (role `AmazonBusinessOrderPlacement`)
- Does your platform intend to use an Agent: No — internal automation on our own
  account only.

## Where we actually stand
- ✅ **LWA app + sandbox auth WORKS.** Connector `_lib/amazon-business.js` mints an LWA
  token against `sandbox.na.business-api.amazon.com` (`amazon-business-test?secret=` →
  `token_acquired:true`). Payload schema built to the documented order shape.
- ❌ **No production application submitted, no Amazon Business rep engaged, no onboarding
  thread in any inbox.** (Searched — only Frontdoor's "API Integration" thread exists.)
- ❌ Missing the 3 account-side values production needs: `GROUP_ID`, `BUYER_EMAIL`, `PAYMENT_REF`.

## The honest reality (set expectations)
The Amazon Business API (Ordering) is aimed at **enterprise buyers + procurement-software
integrators** (Coupa/SAP Ariba/punchout). Production access is **relationship-gated** —
you go through an **Amazon Business Customer Advisor / the API onboarding team**, not a
self-serve "approve" button. A solo small buyer may or may not qualify; the way to find
out is to ask directly. Persistence + a clean first-party use case is what won us the
Google Ads API, so it's worth the ask — but run the browser-bot (below) in parallel so
drop-ship isn't blocked on Amazon's answer.

## THE PLAN — 3 tracks, run in parallel

### Track 1 — Ask Amazon Business for production API access (the real gate)
Entry points (use whichever answers fastest):
1. **Amazon Business API "Contact us / Request access"** — business.amazon.com →
   "Amazon Business API" → request access form. State it's for our own account's ordering.
2. **Your Amazon Business account's Customer Advisor** (if one is assigned — check Business
   Settings). Message them directly; fastest path.
3. **Amazon Business Customer Service** → ask for the **API / Integrations** team.

**Ready-to-send request (from tnappliance@gmail.com — the Business account login):**

> Subject: Amazon Business API (Ordering) — production access request, TN Appliance Exchange
>
> Hi,
>
> We're an appliance-repair company (TN Appliance Exchange LLC) and an Amazon Business
> customer. We want to use the **Amazon Business Ordering API** to place our **own**
> procurement orders programmatically — ordering repair parts and drop-shipping them to
> our service customers — on our own Amazon Business account. We are a first-party buyer,
> not building a tool for any third party.
>
> Where we are: our Login-with-Amazon app is built and authenticating successfully against
> the Business API **sandbox**; order payloads validate against your documented schema.
> We're ready for production.
>
> Could you help us with:
> 1. What's required to authorize our app for **production ordering**?
> 2. Setting up the **buying group (GroupIdentity)**, the **authorized buyer email**, and
>    the **stored payment method reference** the API should order against.
>
> Amazon Business account: A-22A7N0U5ZWQ5H · login tnappliance@gmail.com · 866-268-0111.
> Thank you — ready to go live as soon as the app is authorized.
>
> James "Teddy" Pivacek, Owner, TN Appliance Exchange LLC

### Track 2 — Set up the account-side pieces NOW (do these regardless of approval)
In the **Amazon Business account** (business.amazon.com → Business Settings). These are
the 3 values production needs; having them ready removes the last blocker:
- **Buying group** — Business Settings → Members → **Groups** → create a group (e.g.
  "Parts Ordering"). Note its id → vault `AMAZON_BUSINESS_GROUP_ID`.
- **Buyer email** — the user the API orders "as" (your account owner email is fine) →
  vault `AMAZON_BUSINESS_BUYER_EMAIL`.
- **Stored/shared payment method** — Business Settings → **Payment methods** → add the
  business card as a shared payment method. Note its reference id → vault `AMAZON_BUSINESS_PAYMENT_REF`.
  (Some shared-payment/group features need **Business Prime** — check; a basic business
  card + group usually exists on standard accounts.)

Once these three are vaulted + Track 1 grants production: Claude flips
`AMAZON_BUSINESS_ENV=production`, we run a $1 trial order, then go live. One move.

### Track 3 — Browser-bot drop-ship (the parallel fast path, ZERO approval)
`colony-loop/parts/amazon-order.js` already drives the logged-in Amazon Business checkout
to order by ASIN and ship to the customer (safe: stops at the review screen unless
`--place`). Same pattern as the live Marcone daemon. This makes Amazon-equivalent parts
auto-orderable **this week** while Track 1 cooks — and since Marcone already covers OEM
ordering, this may be all we ever need.
- One-time at the Mac: `cd colony-loop/parts && node login.js amazon` (log into the
  Amazon **Business** buyer account in that window; leave it) → `node serve.js`.
- Then `node amazon-order.js <ASIN> --to "Name|Street|City|ST|Zip|Phone"` (review) → add
  `--place` to actually order. Paste the `shots/` screenshots back to Claude to lock the
  checkout selectors.

## Bottom line
- **The API (#2) production gate is a human/relationship ask** — send the Track 1 request
  + do the Track 2 account setup. That's the whole path; there's no self-serve button.
- **Don't let drop-ship wait on it** — Track 3 (browser bot) ships the same capability now.
