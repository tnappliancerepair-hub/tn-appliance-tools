# crypto-sim 🧪 — paper-mode strategy simulator

Teddy's personal side-project (not part of the appliance business). A safe
sandbox to **learn whether an exit strategy actually beats holding** — the
lesson from holding through gains until they reversed.

## ⚠️ Safety first — this cannot lose you a penny
- **No real money. No exchange account. No API keys. No trades.**
- It only **reads public prices** from CoinGecko (free, no login).
- Everything is simulated ("paper"). There is nothing here to hack or drain.

## What it does
Watches live prices **forward from when you start it** and runs your rules on a
pretend position, then compares your **strategy vs. plain buy-and-hold** so you
can see if the discipline actually helps.

Your rules (in `config.json`):
- **Take-profit:** up `take_profit_pct` from entry → sell to stable (lock gains)
- **Trailing-stop:** down `trailing_stop_pct` from the high → sell to stable
  (this is your "exit on the first downturn")
- **Re-enter:** while parked, up `rebuy_after_rise_pct` off the low → buy back in

## Run it
```bash
cd crypto-sim
node simulator.js          # one snapshot — update + print the dashboard
node simulator.js --watch  # loop forever, polling every poll_seconds
node simulator.js --reset  # wipe state, start fresh from right now
```
Needs Node 18+ (for built-in fetch). State saves to `state.json` between runs,
so you can run it on a schedule or whenever and it keeps tracking.

## Edit your strategy
Open `config.json`, change the coins, dollar allocations, and the three
percentages. Re-run with `--reset` to restart the test with new rules.

## The honest caveats (read these)
- This is a **forward** test, on purpose. It does NOT backtest the past —
  because "what would've worked last year" is the hindsight trap that fools
  everyone. The only honest test is watching it play out forward.
- **Trailing stops get whipsawed:** too tight and a normal dip stops you out
  right before it rips back up; too loose and you give back a lot. The "perfect"
  exit only looks perfect in hindsight.
- **Good paper performance ≠ real performance.** Watch it for weeks before you'd
  trust the idea with a dollar.
- If you ever DO want this live, most exchanges (Coinbase, Kraken, etc.) have
  **native trailing-stop and take-profit orders** — you likely never need a
  custom bot, and you avoid the API-key security + 24/7-reliability + tax-on-
  every-trade headaches a bot brings.

## The one number that matters
**"strategy edge over holding"** at the bottom of the dashboard. If your rules
can't consistently beat just holding over time, that's the most valuable thing
this teaches you — before it costs you anything.
