# Amazon Business Ordering API — setup (auto-order parts, ship to customer)

Goal: a customer picks an aftermarket part → we place the order on our **Amazon
Business** account via API → it ships **to the customer's door** → tech auto-scheduled.
No keyboard.

The code is built and waiting (`netlify/functions/_lib/amazon-business.js` +
`amazon-business-order.js`). It runs in **TrialMode** (validates, no real order) until
you pass `live:true`, and falls back to the manual one-tap path until enrolled.

## What Amazon requires (the gated part — this is the lead time)

1. **Amazon Business account** ✅ (you have this)
2. **Register a Login-with-Amazon (LWA) app** at https://developer.amazon.com → Login
   with Amazon → create a Security Profile → get **Client ID** + **Client Secret**.
3. **Apply for the Amazon Business Ordering API** + the **Order Placement role**:
   https://docs.business.amazon.com/docs/ordering-api — complete the "partner and
   customer onboarding." This is an approval step (can take a bit; it's the long pole).
4. In your Amazon Business account, set up:
   - a **stored payment method** (the card orders charge to) → note its reference id
   - a **buying group** + your **buyer email** (the API orders "as" this buyer/group)
5. **Authorize** the LWA app once to get a **refresh token** (standard LWA OAuth consent).

## Then drop these in the vault (admin-secrets.html)

| Vault key | Value |
|---|---|
| `AMAZON_LWA_CLIENT_ID` | from the LWA security profile |
| `AMAZON_LWA_CLIENT_SECRET` | from the LWA security profile |
| `AMAZON_LWA_REFRESH_TOKEN` | from the one-time OAuth authorize |
| `AMAZON_BUSINESS_GROUP_ID` | your buying group id |
| `AMAZON_BUSINESS_BUYER_EMAIL` | the buyer email on the account |
| `AMAZON_BUSINESS_PAYMENT_REF` | the stored payment method reference |
| `AMAZON_BUSINESS_REGION` | `US` |

## How it works once set

- `POST /.netlify/functions/amazon-business-order { order_id, asin }` →
  TrialMode validate (safe). We confirm Amazon accepts it.
- Flip a real order with `{ order_id, asin, live:true }` → Amazon ships to the
  customer; we stamp the Amazon order id on the parts order + set the job awaiting_parts.
- ASIN comes from the authenticated Amazon lookup (the Playwright finder) — so the
  customer's "aftermarket" option maps to a real, orderable product.

## Reference
- Ordering API overview: https://docs.business.amazon.com/docs/ordering-api
- placeOrder: https://docs.business.amazon.com/docs/placing-an-order
- Endpoint: `POST https://na.business-api.amazon.com/ordering/2022-10-30/orders`
- Auth: LWA refresh token → access token → `x-amz-access-token` header
