// Browser/session manager using Playwright storageState (cookies + localStorage
// serialized to a JSON file). This is the reliable "log in once, reuse" pattern —
// more dependable than a persistent profile for session-scoped auth cookies.
//
//   login.js  → open(supplier, {headless:false}) → user logs in → saveState()
//   lookup/order → open(supplier) loads the saved state → already authenticated

'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, 'profiles');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function stateFile(supplier) { return path.join(ROOT, supplier + '.json'); }
function hasState(supplier) { try { return fs.existsSync(stateFile(supplier)); } catch (_) { return false; } }

// open a browser + context. Loads saved login state if present.
async function open(supplier, { headless = true } = {}) {
  const browser = await chromium.launch({ headless });
  const opts = { viewport: { width: 1280, height: 900 }, userAgent: UA };
  const sf = stateFile(supplier);
  if (fs.existsSync(sf)) { try { opts.storageState = sf; } catch (_) {} }
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  return { browser, ctx, page };
}

// serialize the current session (cookies + localStorage) to disk
async function saveState(ctx, supplier) {
  try { fs.mkdirSync(ROOT, { recursive: true }); } catch (_) {}
  await ctx.storageState({ path: stateFile(supplier) });
}

module.exports = { open, saveState, hasState, stateFile, ROOT };
