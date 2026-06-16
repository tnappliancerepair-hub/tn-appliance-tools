// Live session daemon — Teddy's "keep it open and running to search" idea.
// Opens ONE headed browser that STAYS ALIVE. You log into each supplier once in
// its tab; because the browser/context never closes, the session (cookies +
// sessionStorage + memory) stays authenticated — which is the only thing that
// works for SPA/sessionStorage auth like Marcone.
//
// Run:   node serve.js
// Then:  log into Marcone (and Amazon/Tribles) in the windows that open.
// Lookup: http://127.0.0.1:8787/lookup?supplier=marcone&model=WTW6800WL
// Status: http://127.0.0.1:8787/
//
// The colony loop calls this localhost endpoint, gets parts, writes to Xano.

'use strict';
const http = require('http');
const { chromium } = require('playwright');
const SUPPLIERS = require('./suppliers');

const PORT = process.env.PARTS_PORT ? Number(process.env.PARTS_PORT) : 8787;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PART_SRC = '\\b(?=[A-Z0-9-]{5,16}\\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*[0-9])[A-Z]{1,4}[A-Z0-9]*-?[A-Z0-9]+\\b';

let browser;
const tabs = {}; // supplier -> Page (kept alive + logged in)

async function tabFor(supplier) {
  const cfg = SUPPLIERS[supplier];
  if (!cfg) throw new Error('unknown supplier');
  if (tabs[supplier] && !tabs[supplier].isClosed()) return tabs[supplier];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: UA });
  const page = await ctx.newPage();
  await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  tabs[supplier] = page;
  console.log(`\n🪟  Opened ${cfg.label} — log in there once. It stays open; lookups reuse it.`);
  return page;
}

async function doLookup(supplier, model) {
  const cfg = SUPPLIERS[supplier];
  const page = await tabFor(supplier);
  // search in the LIVE authenticated tab
  await page.goto(cfg.searchUrl(model), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  if (cfg.searchSelector) {
    const box = await page.$(cfg.searchSelector).catch(() => null);
    if (box) { try { await box.fill(model); await box.press('Enter'); await page.waitForLoadState('domcontentloaded', { timeout: 30000 }); } catch (_) {} }
  }
  await page.waitForTimeout(2500);
  const final_url = page.url();
  const candidates = await page.evaluate((src) => {
    const out = []; const seen = new Set();
    const priceRe = /\$\s?\d{1,4}(?:\.\d{2})?/; const partRe = new RegExp(src, 'g');
    const nodes = Array.from(document.querySelectorAll('a, li, .product, [class*="product" i], [class*="result" i], tr'));
    for (const n of nodes) {
      const text = (n.innerText || n.textContent || '').trim();
      if (!text || text.length > 400) continue;
      const priceM = text.match(priceRe); const partM = text.match(partRe);
      if (!partM) continue; const pn = partM[0]; if (seen.has(pn)) continue; seen.add(pn);
      const a = n.tagName === 'A' ? n : n.querySelector('a');
      out.push({ part_number: pn, name: text.replace(/\s+/g, ' ').slice(0, 120), price: priceM ? priceM[0].replace(/\s/g, '') : '', url: a ? a.href : '' });
      if (out.length >= 12) break;
    }
    return out;
  }, PART_SRC);
  return { supplier, label: cfg.label, model, final_url, page_title: await page.title().catch(() => ''), candidates };
}

async function main() {
  browser = await chromium.launch({ headless: false });
  // pre-open the login-required suppliers so you can sign in up front
  for (const s of Object.keys(SUPPLIERS)) { if (!SUPPLIERS[s].noLogin) { try { await tabFor(s); } catch (_) {} } }

  http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
    res.setHeader('Content-Type', 'application/json');
    if (u.pathname === '/lookup') {
      const supplier = (u.searchParams.get('supplier') || '').toLowerCase();
      const model = u.searchParams.get('model') || '';
      if (!SUPPLIERS[supplier] || !model) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'supplier + model required' })); }
      try { res.end(JSON.stringify(await doLookup(supplier, model))); }
      catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String((e && e.message) || e) })); }
      return;
    }
    res.end(JSON.stringify({ ok: true, alive: true, suppliers: Object.keys(SUPPLIERS), open_tabs: Object.keys(tabs) }));
  }).listen(PORT, '127.0.0.1', () => {
    console.log(`\n✅ Parts session daemon on http://127.0.0.1:${PORT}`);
    console.log(`   Log into the open windows (Marcone first). Then test:`);
    console.log(`   curl "http://127.0.0.1:${PORT}/lookup?supplier=marcone&model=WTW6800WL"`);
    console.log(`   (leave this running — it keeps the sessions alive)`);
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
