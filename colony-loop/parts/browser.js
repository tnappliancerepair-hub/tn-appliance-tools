// Persistent Playwright context per supplier. Each supplier gets its own Chrome
// profile dir under ./profiles/<supplier>, so once you log in there, the session
// (cookies + "remember me") persists across runs — no passwords in code.

'use strict';
const path = require('path');
const { chromium } = require('playwright');

const PROFILE_ROOT = path.join(__dirname, 'profiles');

async function openContext(supplier, { headless = true } = {}) {
  const dir = path.join(PROFILE_ROOT, supplier);
  // persistent context = real profile on disk; logged-in state survives restarts
  const ctx = await chromium.launchPersistentContext(dir, {
    headless,
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  return ctx;
}

module.exports = { openContext, PROFILE_ROOT };
