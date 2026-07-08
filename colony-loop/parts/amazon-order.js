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

async function orderToCustomer({ asin, quantity = 1, ship = {}, place = false, headless = true, po = '' }) {
  const out = { ok: false, asin, step: 'start', placed: false, screenshots: [], notes: [] };
  // This Business account REQUIRES a PO number to check out. Use the caller's PO (the job #
  // when wired to a real order), else a stable ref so the order is tagged + can proceed.
  const poNumber = String(po || ('TN-' + asin)).slice(0, 40);
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
    out.notes.push('buy_now=' + (bought || 'none'));
    if (!bought) {
      // Fall back to add-to-cart. First EMPTY the cart so leftover items from earlier runs
      // aren't ordered too (Business has no Buy-Now, so the cart persists between runs).
      let cleared = 0;
      try {
        await page.goto('https://www.amazon.com/gp/cart/view.html', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(1500);
        for (let i = 0; i < 15; i++) {
          const del = await clickFirst(page, ['input[value="Delete" i]', 'input[data-feature-id="item-delete-button"]', '[data-action="delete"] input', '.sc-action-delete input', 'span[data-action="delete"] input']);
          let d = del;
          if (!d) { try { const b = page.getByRole('button', { name: /^delete$/i }).first(); if (await b.count()) { await b.click({ timeout: 3000 }); d = 'delete-btn'; } } catch (_) {} }
          if (!d) break;
          cleared++; await page.waitForTimeout(1200);
        }
      } catch (_) {}
      out.notes.push('cart_cleared=' + cleared);
      // Now add just this one item and proceed to checkout.
      await page.goto(`https://www.amazon.com/dp/${encodeURIComponent(asin)}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(1500);
      try { const q = await page.$('#quantity, select[name="quantity"]'); if (q && quantity > 1) await q.selectOption(String(quantity)).catch(() => {}); } catch (_) {}
      await clickFirst(page, ['#add-to-cart-button', 'input#add-to-cart-button']);
      await page.waitForTimeout(1500);
      await page.goto('https://www.amazon.com/gp/cart/view.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await clickFirst(page, ['input[name="proceedToRetailCheckout"]', 'a[href*="checkout" i]', '#sc-buy-box-ptc-button input']);
    }
    await page.waitForTimeout(3000);
    await shot(page, '2-checkout', out);

    // 3. Amazon BUSINESS checkout is a multi-step PROCUREMENT accordion, not the consumer
    //    1-click: Business Order Info (PO#) -> Select a delivery address -> Payment method
    //    -> Review items & shipping -> Place your order. Each section has its own "Continue".
    //    We walk them in order with TEXT-based clicks (robust to Amazon's shifting ids) and
    //    drop a screenshot at each sub-step so the flow is easy to see + tune.
    out.step = 'business_checkout';
    out.notes.push('Ship-to target: ' + [ship.name, ship.line1, ship.city, ship.state, ship.zip].filter(Boolean).join(', '));

    // Click the first control matching any given text/regex (button, link, or input submit).
    async function clickText(names, timeout = 6000) {
      for (const n of names) {
        try { const b = page.getByRole('button', { name: n }).first(); if (await b.count()) { await b.click({ timeout }); return String(n); } } catch (_) {}
        try { const l = page.getByRole('link', { name: n }).first(); if (await l.count()) { await l.click({ timeout }); return String(n); } } catch (_) {}
        const t = (n instanceof RegExp) ? n.source.replace(/[\\^$]/g, '') : String(n);
        try { const s = page.locator(`input[type="submit"][value*="${t}" i], input[type="button"][value*="${t}" i]`).first(); if (await s.count()) { await s.click({ timeout }); return t; } } catch (_) {}
      }
      return null;
    }
    const fill = async (sel, val) => { if (!val) return false; const el = await page.$(sel).catch(() => null); if (el) { try { await el.fill(String(val)); return true; } catch (_) {} } return false; };

    // 3a. Business Order Information — this account REQUIRES a PO number, so FILL it, then
    //     Continue. Try the labeled field first (robust), then common id/name/placeholders.
    out.step = 'po';
    let poFilled = false;
    try { const l = page.getByLabel(/po ?number/i).first(); if (await l.count()) { await l.fill(poNumber); poFilled = true; } } catch (_) {}
    if (!poFilled) poFilled = await fill('#po-number-input, #po-number, input[name="poNumber"], input[name*="purchaseOrder" i], input[id*="po" i][id*="number" i], input[placeholder*="PO" i], input[aria-label*="PO" i]', poNumber);
    out.notes.push('po_filled=' + poFilled + ' (' + poNumber + ')');
    await page.waitForTimeout(600);
    out.notes.push('po_continue=' + await clickText([/^continue$/i, /continue/i]));
    await page.waitForTimeout(2200);
    await shot(page, '3a-after-po', out);

    // 3b. Delivery address — add the customer's address if there's an add-new form; else
    //     continue with whatever's selected (a saved address on the account).
    out.step = 'address';
    const addNew = await clickText([/add a new address/i, /add.*delivery address/i, /use a new address/i, /add address/i], 4000);
    if (addNew) {
      await page.waitForTimeout(1500);
      await fill('#address-ui-widgets-enterAddressFullName, input[name="address.fullName"]', ship.name);
      await fill('#address-ui-widgets-enterAddressLine1, input[name="address.addressLine1"]', ship.line1);
      await fill('#address-ui-widgets-enterAddressLine2, input[name="address.addressLine2"]', ship.line2);
      await fill('#address-ui-widgets-enterAddressCity, input[name="address.city"]', ship.city);
      await fill('#address-ui-widgets-enterAddressStateOrRegion, input[name="address.stateOrRegion"], select[name="address.stateOrRegion"]', ship.state);
      await fill('#address-ui-widgets-enterAddressPostalCode, input[name="address.postalCode"]', ship.zip);
      await fill('#address-ui-widgets-enterAddressPhoneNumber, input[name="address.phoneNumber"]', ship.phone);
      await shot(page, '3b-address-form', out);
      await clickText([/use this address/i, /add address/i, /save.*address/i], 6000);
      await page.waitForTimeout(2500);
    }
    out.notes.push('addr_continue=' + await clickText([/deliver to this address/i, /use this address/i, /^continue$/i, /continue/i]));
    await page.waitForTimeout(2500);
    await shot(page, '3c-after-address', out);

    // 3c. Payment method — use the shared card already on the account; Continue.
    out.step = 'payment';
    out.notes.push('pay_continue=' + await clickText([/use this payment method/i, /^continue$/i, /continue/i]));
    await page.waitForTimeout(2500);
    await shot(page, '4-after-payment', out);

    // 3d. Review items and shipping — a final Continue may be needed to reach it.
    out.step = 'review';
    await clickText([/^continue$/i, /continue/i], 3000);
    await page.waitForTimeout(2000);
    await shot(page, '5-review', out);

    // 4. Place the order ONLY if explicitly told to.
    if (place) {
      out.step = 'place';
      const placed = await clickText([/place your order/i, /place order/i, /submit.*order/i], 8000);
      await page.waitForTimeout(4500);
      await shot(page, '6-confirmation', out);
      out.placed = !!placed;
      try {
        const txt = await page.innerText('body');
        const m = txt.match(/\b\d{3}-\d{7}-\d{7}\b/);
        if (m) out.order_number = m[0];
        if (/thank you for your order|order (has been )?placed|order confirmed/i.test(txt)) out.confirmed_text = true;
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
    const pi = args.indexOf('--po'); const po = pi >= 0 ? String(args[pi + 1] || '') : '';
    const ti = args.indexOf('--to');
    const parts = ti >= 0 ? String(args[ti + 1] || '').split('|') : [];
    const ship = { name: parts[0], line1: parts[1], city: parts[2], state: parts[3], zip: parts[4], phone: parts[5] };
    if (!asin) { console.error('Usage: node amazon-order.js <ASIN> --to "Name|Street|City|ST|Zip|Phone" [--qty N] [--po REF] [--place] [--headed]'); process.exit(1); }
    const r = await orderToCustomer({ asin, quantity, ship, place, po, headless: !headed });
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { orderToCustomer };
