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

## Live-session daemon (the working path — keeps you logged in)

Marcone auth is SPA/sessionStorage, so saved cookies alone die. `serve.js` keeps
ONE browser open + logged in and searches the live tab:

```bash
node serve.js          # auto-picks a free port (8787, else 8788…); log into the
                       # "Google Chrome for Testing" windows it opens, then leave it running
```

### Two tiers, three endpoints

- **Price tier** (OUR numbers): **Marcone** = OEM cost we order at · **Amazon** =
  aftermarket tier + ship-to-customer. These set the cash-TDR 4 options.
- **Reference tier** (general parts search): **Sears PartsDirect, Tribles, Samsung,
  LG, AppliancePartsPros, PartSelect** — right part # + exploded diagrams + cross-ref
  + retail sanity-check. Mostly public (Tribles needs login).

```
# one supplier
http://127.0.0.1:PORT/lookup?supplier=marcone&model=WTW6800WL
http://127.0.0.1:PORT/lookup?supplier=samsung&serial=0ABC123456   # Samsung → serial

# whole tier in one call
http://127.0.0.1:PORT/search?model=WTW6800WL                      # general parts search (reference)
http://127.0.0.1:PORT/search?tier=price&model=WTW6800WL           # our cost (Marcone + Amazon)
http://127.0.0.1:PORT/search?model=RF28R7351SR&serial=0ABC123456  # serial used where the supplier needs it

# add &debug=1 to dump row HTML for tuning
```

**Samsung is serial-based** — the exact part depends on the production variant the
SERIAL encodes (model alone returns the wrong variant). Pass `&serial=` and the
daemon uses it automatically for Samsung; `/search` does this per-source.

## Then (Claude wires it in)

- A colony agent runs these lookups on a `PARTS_LOOKUP_REQUEST` signal and writes
  results to Xano, so the tech tool + cash-TDR options auto-fill with the exact
  OEM part + your Marcone cost + Amazon aftermarket, plus the reference sources for
  general part-finding + diagrams.
