// One-time interactive login. Opens a real (headed) Chrome to the supplier's
// login page; you sign in by hand (handles 2FA / "remember me"); the session
// saves into ./profiles/<supplier> and is reused headlessly forever after.
//
//   node login.js marcone
//   node login.js tribles
//   node login.js amazon
//
// Log in, make sure you land on the dashboard, then press Enter in the terminal.

'use strict';
const readline = require('readline');
const { openContext } = require('./browser');
const SUPPLIERS = require('./suppliers');

async function main() {
  const supplier = (process.argv[2] || '').toLowerCase();
  const cfg = SUPPLIERS[supplier];
  if (!cfg) {
    console.error('Usage: node login.js <marcone|tribles|amazon>');
    process.exit(1);
  }
  console.log(`\nOpening ${cfg.label} login… sign in in the window that appears.`);
  const ctx = await openContext(supplier, { headless: false });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n➡  Log in fully (land on the dashboard), then press Enter here to save the session… ', () => { rl.close(); resolve(); });
  });

  // sanity: is the logged-in hint present now?
  let ok = false;
  try { ok = !!(await page.$(cfg.loggedInHint)); } catch (_) {}
  console.log(ok ? `✓ ${cfg.label} session saved (looks logged in).` : `Saved ${cfg.label} profile. (Couldn't auto-confirm login — that's fine if you see your account.)`);
  await ctx.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
