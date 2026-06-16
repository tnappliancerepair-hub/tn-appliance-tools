// Amazon Business order via the authenticated browser (no API approval needed).
// Drives the logged-in Amazon Business session to order a part by ASIN and ship
// it to the CUSTOMER. SAFE BY DEFAULT: it stops at the final review screen and
// screenshots every step. It only clicks the real "Place your order" button when
// you pass place:true (CLI: --place).
//
//   node amazon-order.js <ASIN> --to "Name|Street|City|ST|Zip|Phone"          (review only)
//   node amazon-order.js <ASIN> --to "..." --qty 1 --place                    (actually order)
//
// Selectors are best-guesses for Amazon's checkout — run it once, look at the
// screenshots in ./shots/, and we lock them in. Amazon checkout changes often;
// the screenshots make tuning fast + safe.

'use strict';
const fs = require('fs');
const path = require('path');
const { open } = require('./browser');

const SHOTS = path.join(__dirname, 'shots');
function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }

async function shot(page, name, out) {
  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (_) {}
  const p = path.join(SHOTS, `${ts()}_${name}.png`);
  try { await page.screenshot({ path: p, fullPage: false }); out.screenshots.push(p); } catch (_) {}
}

// click the first selector that exists from a list (returns true if clicked)
async function clickFirst(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel).catch(() => null);
    if (el) { try { await el.click({ timeout: 5000 }); return sel; } catch (_) {} }
  }
  return null;
}

async function orderToCustomer({ asin, quantity = 1, ship = {}, place = false, headless = true }) {
  const out = { ok: false, asin, step: 'start', placed: false, screenshots: [], notes: [] };
  const { browser, ctx, page } = await open('amazon', { headless });
  try {
    // 1. product page
    out.step = 'product';
    await page.goto(`https://www.amazon.com/dp/${encodeURIComponent(asin)}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2000);
    out.logged_in = !!(await page.$('#nav-link-accountList-nav-line-1, a[href*="sign-out" i]').catch(() => null));
    await shot(page, '1-product', out);
    if (!out.logged_in) { out.notes.push('Not logged in — run: node login.js amazon'); await browser.close(); return out; }

    // 2. quantity (best-effort) + Buy Now
    out.step = 'buy_now';
    try { const q = await page.$('#quantity, select[name="quantity"]'); if (q && quantity > 1) await q.selectOption(String(quantity)).catch(() => {}); } catch (_) {}
    const bought = await clickFirst(page, ['#buy-now-button', 'input#buy-now-button', '#buyNow', '#submit\\.buy-now']);
    if (!bought) {
      // fall back to add-to-cart then proceed
      await clickFirst(page, ['#add-to-cart-button', 'input#add-to-cart-button']);
      await page.waitForTimeout(1500);
      await page.goto('https://www.amazon.com/gp/cart/view.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await clickFirst(page, ['input[name="proceedToRetailCheckout"]', 'a[href*="checkout" i]', '#sc-buy-box-ptc-button input']);
    }
    await page.waitForTimeout(3000);
    await shot(page, '2-checkout', out);

    // 3. ship to the customer — add/select a NEW delivery address (brittle: tune from shots)
    out.step = 'ship_to';
    out.notes.push('Set ship-to from: ' + [ship.name, ship.line1, ship.city, ship.state, ship.zip].filter(Boolean).join(', '));
    // common entry points to "add a new address"
    await clickFirst(page, ['a:has-text("Add a new address")', 'a:has-text("Add delivery address")', 'input[aria-labelledby*="address" i]', '#add-new-address-popover-link']);
    await page.waitForTimeout(1500);
    // best-guess address fields (Amazon uses these names on the add-address form)
    const fill = async (sel, val) => { if (!val) return; const el = await page.$(sel).catch(() => null); if (el) { try { await el.fill(String(val)); } catch (_) {} } };
    await fill('#address-ui-widgets-enterAddressFullName, input[name="address.fullName"]', ship.name);
    await fill('#address-ui-widgets-enterAddressLine1, input[name="address.addressLine1"]', ship.line1);
    await fill('#address-ui-widgets-enterAddressLine2, input[name="address.addressLine2"]', ship.line2);
    await fill('#address-ui-widgets-enterAddressCity, input[name="address.city"]', ship.city);
    await fill('#address-ui-widgets-enterAddressStateOrRegion, input[name="address.stateOrRegion"], select[name="address.stateOrRegion"]', ship.state);
    await fill('#address-ui-widgets-enterAddressPostalCode, input[name="address.postalCode"]', ship.zip);
    await fill('#address-ui-widgets-enterAddressPhoneNumber, input[name="address.phoneNumber"]', ship.phone);
    await shot(page, '3-address', out);
    await clickFirst(page, ['input[aria-labelledby="address-ui-widgets-form-submit-button-announce"]', '#address-ui-widgets-form-submit-button input', 'input[type="submit"][value*="address" i]', 'input[data-action="address-ui-widgets-saveOnClick"]']);
    await page.waitForTimeout(2500);
    await clickFirst(page, ['input[aria-labelledby*="useThisAddress" i]', 'input[value*="Use this address" i]', '#shipToThisAddressButton input']);
    await page.waitForTimeout(2500);
    await shot(page, '4-payment-or-review', out);

    // 4. continue through payment (use the account default) to the review screen
    out.step = 'review';
    await clickFirst(page, ['input[name="ppw-widgetEvent:SetPaymentPlanSelectContinueEvent"]', 'a:has-text("Use this payment method")', '#continue-top input', 'input[value*="Continue" i]']);
    await page.waitForTimeout(2500);
    await shot(page, '5-review', out);

    // 5. place the order ONLY if explicitly told to
    if (place) {
      out.step = 'place';
      const placed = await clickFirst(page, ['#placeYourOrder input', 'input[name="placeYourOrder1"]', '#submitOrderButtonId input', 'input[aria-labelledby*="placeYourOrder" i]', '#bottomSubmitOrderButtonId input']);
      await page.waitForTimeout(4000);
      await shot(page, '6-confirmation', out);
      out.placed = !!placed;
      // try to read an order number from the confirmation
      try {
        const txt = await page.innerText('body');
        const m = txt.match(/\b\d{3}-\d{7}-\d{7}\b/);
        if (m) out.order_number = m[0];
      } catch (_) {}
    }

    out.ok = true;
  } catch (e) {
    out.error = String((e && e.message) || e);
    try { await shot(page, 'error', out); } catch (_) {}
  } finally {
    await browser.close().catch(() => {});
  }
  return out;
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const asin = args.find((a) => !a.startsWith('--')) || '';
    const place = args.includes('--place');
    const headed = args.includes('--headed');
    const qi = args.indexOf('--qty'); const quantity = qi >= 0 ? parseInt(args[qi + 1], 10) || 1 : 1;
    const ti = args.indexOf('--to');
    const parts = ti >= 0 ? String(args[ti + 1] || '').split('|') : [];
    const ship = { name: parts[0], line1: parts[1], city: parts[2], state: parts[3], zip: parts[4], phone: parts[5] };
    if (!asin) { console.error('Usage: node amazon-order.js <ASIN> --to "Name|Street|City|ST|Zip|Phone" [--qty N] [--place] [--headed]'); process.exit(1); }
    const r = await orderToCustomer({ asin, quantity, ship, place, headless: !headed });
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { orderToCustomer };
