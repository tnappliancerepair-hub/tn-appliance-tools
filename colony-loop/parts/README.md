# Authenticated parts lookup (Marcone / Tribles / Amazon Business)

Pulls **exact part numbers + your real pricing** from suppliers you're logged into,
using a real browser on the Mac Mini (no scraping that gets 403'd). Kept separate
from the zero-dependency colony loop.

## One-time setup (Mac Mini)

```bash
cd ~/tn-appliance-tools/colony-loop/parts
npm install
npx playwright install chromium
```

## Log in once per supplier (passwords stay on the Mac, never in code)

```bash
node login.js marcone     # a Chrome window opens — log in, land on dashboard, press Enter
node login.js tribles
node login.js amazon
```

The logged-in session is saved under `profiles/<supplier>/` and reused automatically
(the `profiles/` folder is git-ignored — credentials never leave the Mac).

## Test a lookup (this is the step that tunes it)

```bash
node lookup.js marcone WTW5000DW1
node lookup.js --all WTW5000DW1
# add --headed to watch it work
node lookup.js marcone WTW5000DW1 --headed
```

It prints JSON candidates. **Paste that output back to Claude** — the extractor is
generic on day one; with one real result page we lock in the exact search URL +
result selectors so it returns the right part + price every time.

## Then (Claude wires it in)

- A colony agent runs these lookups on a `PARTS_LOOKUP_REQUEST` signal and writes
  results to Xano, so the tech tool + cash-TDR options auto-fill with the exact
  OEM part (Marcone/Tribles) + aftermarket (Amazon) + your pricing.
