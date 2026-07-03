# Amazon drop-ship (browser bot) — #2, no API approval needed

This orders an Amazon part by ASIN and ships it straight to the customer, using your
logged-in **Amazon Business** buyer session. **Zero Amazon approval, no token.** Same
pattern as the live Marcone daemon. Safe by default: it stops at the review screen and
only clicks "Place your order" when you pass `--place`.

## One-time setup at the Mac
```
cd ~/tn-appliance-tools && git pull origin main
cd colony-loop/parts
npm install && npx playwright install chromium      # first time only
node login.js amazon
```
`login.js amazon` opens a real browser at Amazon Business. **Sign in, confirm the
top-left shows your Business account**, then press Enter in the terminal — it saves the
session to `profiles/amazon.json` and reuses it forever.

## Test it (REVIEW ONLY — nothing gets bought)
Pick any real ASIN (from the product URL `amazon.com/dp/<ASIN>`), use a test address:
```
node amazon-order.js B0XXXXXXXX --to "Jane Doe|123 Main St|Murfreesboro|TN|37130|6155551234" --headed
```
- `--headed` = watch it happen. Leave it off to run invisibly.
- It walks: product → Buy Now → add the customer's ship-to → payment (account default) →
  **stops at the review screen.** No order placed.
- Screenshots of every step land in `colony-loop/parts/shots/`.

## Send the screenshots back
Paste the `shots/*.png` here. Amazon's checkout selectors are best-guesses; the
screenshots let me lock them to the real Business checkout in one pass.

## Place a real order (only when you mean it)
```
node amazon-order.js B0XXXXXXXX --to "Name|Street|City|ST|Zip|Phone" --qty 1 --place
```
It prints the Amazon order number on success.

## Next (after it's proven)
Wire it to the cash-TDR flow so a customer picking the Amazon-equivalent part auto-fires
this with their address — fully hands-off drop-ship. (Marcone already covers OEM ordering,
so this bot is all that's needed for the aftermarket tier.)
