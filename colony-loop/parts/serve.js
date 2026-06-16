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
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const SUPPLIERS = require('./suppliers');

// The colony agent (parts_lookup_request.js) reads this to find the live daemon
// even when it auto-hopped to a different port. Written on bind, removed on exit.
const PORT_FILE = path.join(__dirname, '.daemon-port');
function writePortFile(port) { try { fs.writeFileSync(PORT_FILE, String(port)); } catch (_) {} }
function removePortFile() { try { fs.unlinkSync(PORT_FILE); } catch (_) {} }
process.on('exit', removePortFile);
process.on('SIGINT', () => { removePortFile(); process.exit(0); });
process.on('SIGTERM', () => { removePortFile(); process.exit(0); });

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

async function doLookup(supplier, model, debug, serial) {
  const cfg = SUPPLIERS[supplier];
  const page = await tabFor(supplier);
  // Samsung & friends: the exact part depends on the production variant the SERIAL
  // encodes. Search by serial when the supplier asks for it and we have one.
  const ident = (cfg.lookupBy === 'serial' && serial) ? serial : model;
  // search in the LIVE authenticated tab
  await page.goto(cfg.searchUrl(ident), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  if (cfg.searchSelector) {
    const box = await page.$(cfg.searchSelector).catch(() => null);
    if (box) { try { await box.fill(ident); await box.press('Enter'); await page.waitForLoadState('domcontentloaded', { timeout: 30000 }); } catch (_) {} }
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
  const resp = { supplier, label: cfg.label, tier: cfg.tier || null, searched_by: (cfg.lookupBy === 'serial' && serial) ? 'serial' : 'model', model, serial: serial || null, final_url, page_title: await page.title().catch(() => ''), candidates: result.candidates };
  if (cfg.note) resp.note = cfg.note;
  if (debug) resp.debug_html = result.debug;
  return resp;
}

// Search a whole tier ('reference' = general parts search, 'price' = our cost) in
// one call. One endpoint the colony loop / tools hit instead of N round-trips.
async function doTierLookup(tier, model, serial, debug) {
  const names = Object.keys(SUPPLIERS).filter((s) => (SUPPLIERS[s].tier || 'reference') === tier);
  const results = [];
  for (const s of names) {
    try { results.push(await doLookup(s, model, debug, serial)); }
    catch (e) { results.push({ supplier: s, label: (SUPPLIERS[s] && SUPPLIERS[s].label) || s, error: String((e && e.message) || e), candidates: [] }); }
  }
  return { tier, model, serial: serial || null, sources: results };
}

// Intelligence pull (MSA World / Whirlpool University): given a model, navigate
// the authenticated portal and extract recalls + technical service bulletins +
// tech-sheet/manual links + key notes. Generic + tunable (use ?debug=1 to dump
// HTML on first login). On-demand + model-specific only — never bulk-mirrored.
async function doIntel(source, brand, model, debug) {
  const cfg = SUPPLIERS[source];
  if (!cfg || !cfg.intelligence) throw new Error('unknown intel source');
  const page = await tabFor(source);
  // Intel portals (MSA etc.) match the bare MODEL number; a brand prefix makes it an
  // AND-search that returns nothing. Search by model, fall back to brand. (2026-06-16)
  const q = model || brand;
  await page.goto(cfg.searchUrl(q), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  if (cfg.searchSelector) {
    const box = await page.$(cfg.searchSelector).catch(() => null);
    if (box) { try { await box.fill(q); await box.press('Enter'); await page.waitForLoadState('domcontentloaded', { timeout: 30000 }); } catch (_) {} }
  }
  await page.waitForTimeout(2500);
  const logged_in = cfg.loggedInHint ? !!(await page.$(cfg.loggedInHint).catch(() => null)) : true;
  const final_url = page.url();
  const result = await page.evaluate(() => {
    const txt = (el) => ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
    const lines = Array.from(document.querySelectorAll('h1,h2,h3,h4,li,p,td,a,div'))
      .map(txt).filter((t) => t && t.length > 8 && t.length < 400);
    const uniq = Array.from(new Set(lines));
    const recalls = uniq.filter((t) => /\brecall\b/i.test(t)).slice(0, 10);
    const bulletins = uniq.filter((t) => /\b(service bulletin|technical bulletin|tsb|service flash|service pointer)\b/i.test(t)).slice(0, 10);
    const tech_sheets = Array.from(document.querySelectorAll('a'))
      .map((a) => ({ text: (a.innerText || '').replace(/\s+/g, ' ').trim(), href: a.href || '' }))
      .filter((x) => x.href && /(\.pdf|tech.?sheet|service.?manual|manual|wiring|schematic|fast.?track|mini.?manual)/i.test(x.text + ' ' + x.href))
      .slice(0, 12);
    return { recalls, bulletins, tech_sheets, sample: uniq.slice(0, 20) };
  });
  const resp = { source, label: cfg.label, brand, model, logged_in, final_url, recalls: result.recalls, bulletins: result.bulletins, tech_sheets: result.tech_sheets };
  if (debug) resp.debug_sample = result.sample;
  return resp;
}

const VERSION = '2026-06-16f-intel';

function requestHandler(tabs) {
  return async (req, res) => {
    const u = new URL(req.url, `http://127.0.0.1`);
    res.setHeader('Content-Type', 'application/json');
    if (u.pathname === '/__shutdown') { res.end(JSON.stringify({ ok: true, bye: true })); setTimeout(() => process.exit(0), 200); return; }
    if (u.pathname === '/__version') { res.end(JSON.stringify({ version: VERSION })); return; }
    if (u.pathname === '/health') {
      // Per-login-supplier session status. The live session dies if a window is
      // closed or logged out — this is how the keep-alive watcher (watch.js)
      // knows to text Teddy to re-log in. noLogin suppliers are always "ok".
      (async () => {
        const out = {};
        for (const s of Object.keys(SUPPLIERS)) {
          const cfg = SUPPLIERS[s];
          if (cfg.noLogin) continue;
          const page = tabs[s];
          const open = !!(page && !page.isClosed());
          let logged_in = false;
          if (open && cfg.loggedInHint) {
            try { logged_in = !!(await page.$(cfg.loggedInHint)); } catch (_) { logged_in = false; }
          }
          out[s] = { open, logged_in };
        }
        // "healthy" = the two pricing sources (Marcone + Amazon) are logged in
        const healthy = !!(out.marcone && out.marcone.logged_in && out.amazon && out.amazon.logged_in);
        res.end(JSON.stringify({ ok: true, version: VERSION, healthy, suppliers: out }));
      })().catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); });
      return;
    }
    if (u.pathname === '/lookup') {
      const supplier = (u.searchParams.get('supplier') || '').toLowerCase();
      const model = u.searchParams.get('model') || '';
      const serial = u.searchParams.get('serial') || '';
      if (!SUPPLIERS[supplier] || (!model && !serial)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'supplier + model (or serial) required' })); }
      const debug = u.searchParams.get('debug') === '1';
      try { res.end(JSON.stringify(await doLookup(supplier, model, debug, serial))); }
      catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String((e && e.message) || e) })); }
      return;
    }
    // General parts search across a whole tier in one call.
    //   /search?model=WTW6800WL            → reference tier (all general sources)
    //   /search?tier=price&model=...        → our price sources (Marcone + Amazon)
    //   /search?model=...&serial=...        → Samsung etc. use the serial automatically
    if (u.pathname === '/search') {
      const tier = (u.searchParams.get('tier') || 'reference').toLowerCase();
      const model = u.searchParams.get('model') || '';
      const serial = u.searchParams.get('serial') || '';
      if (!model && !serial) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'model (or serial) required' })); }
      const debug = u.searchParams.get('debug') === '1';
      try { res.end(JSON.stringify(await doTierLookup(tier, model, serial, debug))); }
      catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String((e && e.message) || e) })); }
      return;
    }
    // Intelligence pull: recalls / bulletins / tech-sheets for a model.
    //   /intel?source=msa&brand=Whirlpool&model=WTW5000DW1  (&debug=1 dumps a text sample)
    if (u.pathname === '/intel') {
      const source = (u.searchParams.get('source') || 'msa').toLowerCase();
      const brand = u.searchParams.get('brand') || '';
      const model = u.searchParams.get('model') || '';
      if (!SUPPLIERS[source] || !SUPPLIERS[source].intelligence) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'valid intelligence source required (msa, whirlpool)' })); }
      if (!model && !brand) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'brand or model required' })); }
      const debug = u.searchParams.get('debug') === '1';
      try { res.end(JSON.stringify(await doIntel(source, brand, model, debug))); }
      catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String((e && e.message) || e) })); }
      return;
    }
    const byTier = {};
    for (const s of Object.keys(SUPPLIERS)) { const t = SUPPLIERS[s].tier || 'reference'; (byTier[t] = byTier[t] || []).push(s); }
    res.end(JSON.stringify({ ok: true, alive: true, version: VERSION, tiers: byTier, open_tabs: Object.keys(tabs) }));
  };
}

// bind the FIRST free port (so a leftover zombie on 8787 can never crash us)
async function bindFreePort(handler, startPort) {
  for (let p = startPort; p < startPort + 20; p++) {
    const server = http.createServer(handler);
    const ok = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(p, '127.0.0.1', () => resolve(true));
    });
    if (ok) return { server, port: p };
    try { server.close(); } catch (_) {}
  }
  return null;
}

async function main() {
  // 1) get the server up on a free port FIRST — never crash on a busy port
  const bound = await bindFreePort(requestHandler(tabs), PORT);
  if (!bound) { console.error('\n⚠ Could not find a free port near ' + PORT); process.exit(1); }
  const ACTUAL = bound.port;
  writePortFile(ACTUAL); // so the colony agent can find us on whatever port we landed on

  // 2) only now launch the browser + open the login tabs (so windows never vanish)
  browser = await chromium.launch({ headless: false });
  for (const s of Object.keys(SUPPLIERS)) { if (!SUPPLIERS[s].noLogin) { try { await tabFor(s); } catch (_) {} } }

  console.log(`\n✅ Parts session daemon LIVE on http://127.0.0.1:${ACTUAL}  (version ${VERSION})`);
  if (ACTUAL !== PORT) console.log(`   (port ${PORT} was busy — using ${ACTUAL} instead)`);
  console.log(`   Log into the open "Google Chrome for Testing" windows (Marcone first), then:`);
  console.log(`   open in a browser:  http://127.0.0.1:${ACTUAL}/lookup?supplier=marcone&model=WTW6800WL`);
  console.log(`   (leave this terminal running — it keeps the sessions alive)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
