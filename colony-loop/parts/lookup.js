// Authenticated parts lookup. Uses the saved logged-in session to search a
// supplier and extract candidate parts (part #, name, price, link). The
// extractor is intentionally GENERIC (scans the results page for part-number
// tokens + nearby prices) so it returns something on day one; we tighten the
// selectors once we see a real result page.
//
//   node lookup.js marcone WTW5000DW1
//   node lookup.js --all WTW5000DW1          (all three suppliers)
//
// Prints JSON: { supplier, query, logged_in, candidates:[{part_number,name,price,url}] }

'use strict';
const { openContext } = require('./browser');
const SUPPLIERS = require('./suppliers');

// Looks like an appliance part number: 5-16 chars, has BOTH letters and digits,
// allows one dash (e.g. WPW10730972, DA97-22162A, 8540101A, WE11X10007).
const PART_RE = /\b(?=[A-Z0-9-]{5,16}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*[0-9])[A-Z]{1,4}[A-Z0-9]*-?[A-Z0-9]+\b/g;

async function lookupOne(supplier, query, { headless = true } = {}) {
  const cfg = SUPPLIERS[supplier];
  if (!cfg) return { supplier, error: 'unknown_supplier' };
  const ctx = await openContext(supplier, { headless });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const out = { supplier, label: cfg.label, query, logged_in: false, candidates: [] };
  try {
    // try the direct search URL first
    await page.goto(cfg.searchUrl(query), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    out.logged_in = cfg.noLogin ? true : (cfg.loggedInHint ? !!(await page.$(cfg.loggedInHint).catch(() => null)) : false);

    // if the URL search didn't land on results, try typing into the search box
    if (cfg.searchSelector) {
      const box = await page.$(cfg.searchSelector).catch(() => null);
      if (box) {
        try { await box.fill(query); await box.press('Enter'); await page.waitForLoadState('domcontentloaded', { timeout: 30000 }); } catch (_) {}
      }
    }
    await page.waitForTimeout(2500);

    // GENERIC extraction: pull anchors + text near prices, regex part #s.
    out.candidates = await page.evaluate((src) => {
      const cands = [];
      const seen = new Set();
      const priceRe = /\$\s?\d{1,4}(?:\.\d{2})?/;
      const partRe = new RegExp(src, 'g');
      // product-ish containers: links + list items + cards
      const nodes = Array.from(document.querySelectorAll('a, li, .product, [class*="product" i], [class*="result" i], tr'));
      for (const n of nodes) {
        const text = (n.innerText || n.textContent || '').trim();
        if (!text || text.length > 400) continue;
        const priceM = text.match(priceRe);
        const partM = text.match(partRe);
        if (!partM) continue;
        const pn = partM[0];
        if (seen.has(pn)) continue;
        seen.add(pn);
        const a = n.tagName === 'A' ? n : n.querySelector('a');
        cands.push({
          part_number: pn,
          name: text.replace(/\s+/g, ' ').slice(0, 120),
          price: priceM ? priceM[0].replace(/\s/g, '') : '',
          url: a ? a.href : '',
        });
        if (cands.length >= 12) break;
      }
      return cands;
    }, PART_RE.source);
  } catch (e) {
    out.error = String((e && e.message) || e);
  } finally {
    await ctx.close().catch(() => {});
  }
  return out;
}

async function lookupAll(query, opts) {
  const names = Object.keys(SUPPLIERS);
  const results = [];
  for (const s of names) { results.push(await lookupOne(s, query, opts)); }
  return results;
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const headed = args.includes('--headed');
    const clean = args.filter((a) => a !== '--headed');
    if (clean[0] === '--all') {
      const r = await lookupAll(clean.slice(1).join(' '), { headless: !headed });
      console.log(JSON.stringify(r, null, 2));
    } else {
      const r = await lookupOne((clean[0] || '').toLowerCase(), clean.slice(1).join(' '), { headless: !headed });
      console.log(JSON.stringify(r, null, 2));
    }
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { lookupOne, lookupAll };
