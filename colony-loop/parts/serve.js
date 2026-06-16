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

async function doLookup(supplier, model, debug) {
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
  const result = await page.evaluate((src) => {
    const partRe = new RegExp(src, 'g');
    const priceRe = /\$\s?\d[\d,]*(?:\.\d{2})?/;

    // ── Marcone precise layout (li.searchResult_li_items) → clean fields incl. your cost + stock
    const mli = document.querySelectorAll('li.searchResult_li_items');
    if (mli.length) {
      const out = []; const dbg = [];
      mli.forEach((li, i) => {
        const pEl = li.querySelector('[part]');
        const part = ((pEl && pEl.getAttribute('part')) || (li.querySelector('h4 a') && li.querySelector('h4 a').innerText) || '').trim();
        if (!part) return;
        const priceEl = li.querySelector('.spanPrice');
        const descEl = li.querySelector('span.coad[title]');
        const brandEl = li.querySelector('.spanBrand');
        const stockEl = li.querySelector('.spanInstock');
        out.push({
          part_number: part,
          name: descEl ? (descEl.getAttribute('title') || descEl.innerText).trim() : '',
          price: priceEl ? priceEl.innerText.replace(/\s/g, '').trim() : '',
          brand: brandEl ? brandEl.innerText.trim() : '',
          stock: stockEl ? stockEl.innerText.replace(/\s+/g, ' ').trim() : '',
          url: '',
        });
        if (i < 3) dbg.push((li.outerHTML || '').replace(/\s+/g, ' ').slice(0, 900));
      });
      return { candidates: out.slice(0, 25), debug: dbg };
    }

    // ── Generic fallback (Amazon, etc.): walk up to the row container
    const out = []; const seen = new Set(); const dbg = [];
    const nodes = Array.from(document.querySelectorAll('tr, li, [class*="row" i], [class*="item" i], [class*="product" i], [class*="result" i], [class*="part" i], a'));
    for (const n of nodes) {
      const own = (n.innerText || n.textContent || '').trim();
      if (!own) continue;
      const pm = own.match(partRe); if (!pm) continue;
      const pn = pm[0]; if (seen.has(pn)) continue;
      let row = n;
      for (let i = 0; i < 5 && row.parentElement; i++) {
        const t = (row.innerText || '').trim();
        if (t.length > pn.length + 4 && (priceRe.test(t) || /^(TR|LI)$/i.test(row.tagName))) break;
        row = row.parentElement;
      }
      const rtext = (row.innerText || '').replace(/\s+/g, ' ').trim();
      seen.add(pn);
      const priceM = rtext.match(priceRe);
      const a = (row.querySelector && row.querySelector('a')) || (n.tagName === 'A' ? n : null);
      out.push({ part_number: pn, name: rtext.slice(0, 180), price: priceM ? priceM[0].replace(/\s/g, '') : '', url: a ? a.href : '' });
      if (dbg.length < 3) dbg.push((row.outerHTML || '').replace(/\s+/g, ' ').slice(0, 1400));
      if (out.length >= 15) break;
    }
    return { candidates: out, debug: dbg };
  }, PART_SRC);
  const resp = { supplier, label: cfg.label, model, final_url, page_title: await page.title().catch(() => ''), candidates: result.candidates };
  if (debug) resp.debug_html = result.debug;
  return resp;
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
      const debug = u.searchParams.get('debug') === '1';
      try { res.end(JSON.stringify(await doLookup(supplier, model, debug))); }
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
