# Parts Drop-Ship Model — LOCKED (Teddy, 2026-06-20)

**Every one of the 4 cash-TDR options drop-ships the part to the customer. No
exceptions, no part ever touches the shop.**

## The model (identical mechanics for all 4 options)
| Option | Part source | Customer pays | Tech visit |
|---|---|---|---|
| `diy_oem` | Marcone (OEM) | YOU (marked-up) | no |
| `diy_amazon` | Amazon (equivalent, cheaper) | YOU (marked-up) | no |
| `install_oem` | Marcone (OEM) | YOU + labor | yes |
| `install_amazon` | Amazon (equivalent) | YOU + labor | yes |

- **Customer always pays US** (Stripe checkout, our price = supplier cost + markup, + $15 flat shipping).
- **Supplier drop-ships straight to the customer's address** (from intake — the customer effectively provided it; we never re-key it).
- **We keep the spread** (customer price − supplier cost). We never physically handle the part.
- **Amazon-equivalent is the high-volume pick** (usually <½ the OEM price), so automating *that* placement pays off most.

## What's ALREADY built (verified 2026-06-20)
- `qc_diagnosis_view` computes all 4 options + customer prices (OEM + Amazon, with markup; `amazon_part_our_cost_cents` stored separately).
- `qc_create_checkout_session` → Stripe with the part price + $15 shipping line.
- `stripe_checkout_session_completed` → on pay, creates a `parts_orders` row, **ship-to-customer**, **supplier tagged** (`marcone` / `amazon`), with the job's service address as `ship_address`, status `to_order`.
- `parts-orders.html` "To Order" board surfaces it; `create-parts-order.js` is the writer.
- Amazon ordering scaffolds exist: `netlify/functions/amazon-business-order.js` (API path, gated until enrolled) + `colony-loop/parts/amazon-order.js` (authenticated browser-bot, works now).

## THE GAP (the only thing left = the build)
The order lands on the To-Order board and **a human still clicks "buy"** on the
supplier. To make it **truly hands-free**, automate the final *placement*:
- **Amazon-equivalent (priority — highest volume):** the browser-bot
  (`amazon-order.js`) logged into Teddy's Amazon Business account on the Mac
  places the ship-to-customer order automatically from the queue. (API path is
  cleaner but needs slow enterprise enrollment.)
- **Marcone (OEM):** same idea — auto-place the ship-to-customer order via the
  Marcone session (the parts daemon already searches; ordering is the add-on).

## NOT affiliate
This is **we-buy-and-drop-ship-with-markup**, NOT Amazon Associates. The customer
pays us our price; we keep the margin. (Affiliate = customer buys themselves =
we'd lose the markup — explicitly NOT the model.)

## Build priority (next session)
1. **Amazon auto-placement** (browser-bot from the To-Order queue, ship-to-customer) — the high-volume win.
2. Marcone auto-placement (same pattern).
3. Until then: orders sit on the To-Order board = one click to fulfill. Fully workable.

## ⭐ DECIDED 2026-06-20 (Teddy): the END GOAL is FULL API automation, not manual
As this scales, no human shops for parts. The target is **fully automated
drop-ship from Amazon via the Amazon Business Ordering API** (and Marcone via its
API). Confirmed real + viable:
- **Amazon Business Ordering API** places orders programmatically AND accepts the
  **shipping address in the request** → true ship-to-customer drop-ship.
  Docs: https://developer-docs.amazon.com/amazon-business/docs/ordering-api +
  /placing-an-order. Scaffold already built: `netlify/functions/amazon-business-order.js`
  (TrialMode-safe, vault-gated, returns configured:false until enrolled).
- **GATE = onboarding:** must complete the "Ordering API partner + customer
  onboarding" and get the **Amazon Business Order Placement role** (credentials).
  Teddy to start this with his Amazon Business account/support. NOT instant, but a
  real, known path — not the dead-end previously assumed.
- **On approval:** drop the API credentials in the vault → flip the scaffold live
  → Amazon-equivalent orders place + ship-to-customer automatically on Stripe
  payment. Hands-free.
- **Browser-bot is the BRIDGE only** (works now, fragile/ToS-gray) — the API is
  the real destination.

