// One-time interactive login. Opens a real (headed) browser to the supplier's
// login page; you sign in by hand (check "Remember me" if offered); on Enter we
// serialize the session (cookies + localStorage) to profiles/<supplier>.json and
// reuse it forever after. Your password never touches code or the terminal.
//
//   node login.js marcone
//   node login.js amazon
//   node login.js tribles

'use strict';
const readline = require('readline');
const { open, saveState, stateFile } = require('./browser');
const SUPPLIERS = require('./suppliers');

async function main() {
  const supplier = (process.argv[2] || '').toLowerCase();
  const cfg = SUPPLIERS[supplier];
  if (!cfg) { console.error('Usage: node login.js <marcone|amazon|tribles>'); process.exit(1); }

  console.log(`\nOpening ${cfg.label} login… sign in in the window that appears (check "Remember me" if shown).`);
  const { browser, ctx, page } = await open(supplier, { headless: false });
  await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n➡  Log in fully (land on the dashboard), then press Enter here to save the session… ', () => { rl.close(); resolve(); });
  });

  // save the live session BEFORE closing (captures session cookies too)
  await saveState(ctx, supplier);
  // sanity: count cookies captured + confirm the logged-in hint if we have one
  let cookieCount = 0;
  try { cookieCount = (await ctx.cookies()).length; } catch (_) {}
  let ok = false;
  try { ok = cfg.loggedInHint ? !!(await page.$(cfg.loggedInHint)) : true; } catch (_) {}
  console.log(`\n✓ Saved ${cfg.label} session → ${stateFile(supplier)}  (${cookieCount} cookies)`);
  if (!ok) console.log('  (Couldn\'t auto-confirm the logged-in marker — that\'s fine if you can see your account.)');
  await browser.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
