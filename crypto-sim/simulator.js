#!/usr/bin/env node
/*
 * crypto-sim — PAPER-MODE strategy simulator.
 *
 * ⚠️  NO real money. NO exchange account. NO API keys. NO trades.
 *     It only READS public prices from CoinGecko (free, no auth) and
 *     simulates what your rules WOULD do. Nothing here can lose a cent.
 *
 * What it does:
 *   - Watches live prices forward from the moment you start it (a forward
 *     paper-test — the HONEST kind; it does NOT backtest the past, which is
 *     where hindsight/overfitting fools you).
 *   - Runs your "take-profit + trailing-stop + re-enter" rules on a paper
 *     position.
 *   - Compares your STRATEGY vs plain BUY-AND-HOLD, side by side, so you can
 *     see whether your exit discipline actually beats just holding.
 *
 * The rules (from config.json):
 *   - TAKE-PROFIT: when price is up take_profit_pct from your entry → sell to
 *     stable (lock the gain).
 *   - TRAILING-STOP: when price falls trailing_stop_pct from its HIGH since
 *     entry → sell to stable (this is your "exit on the first downturn").
 *   - RE-ENTER: while parked in stable, when price rises rebuy_after_rise_pct
 *     off its low → buy back in (trend turned up).
 *
 * Run:
 *   node simulator.js            # one snapshot: update + print
 *   node simulator.js --watch    # loop forever, polling every poll_seconds
 *   node simulator.js --reset    # wipe state and start fresh from now
 *
 * State persists in state.json between runs, so you can run it on a cron or
 * just whenever, and it tracks the strategy over time.
 *
 * REMEMBER: good paper performance ≠ guaranteed real performance. Trailing
 * stops get "whipsawed" (stopped out on a normal dip, then it rips back up
 * without you). This tool is for LEARNING whether your discipline holds up —
 * not a money printer. Watch it for weeks before you'd ever trust it with a
 * dollar, and even then, exchanges have native trailing-stop orders so you may
 * never need a bot at all.
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const STATE_PATH = path.join(__dirname, 'state.json');

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}
function saveJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
function usd(n) { return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function pct(n) { return (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%'; }
function nowISO() { return new Date().toISOString(); }

async function fetchPrices(ids) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`CoinGecko returned ${r.status}`);
  return r.json();
}

// Run the strategy rules for one asset against the current price.
// Mutates `s` (the asset's strategy state) and pushes any event to `log`.
function step(asset, s, price, cfg, log) {
  const tp = cfg.take_profit_pct / 100;
  const trail = cfg.trailing_stop_pct / 100;
  const rebuy = cfg.rebuy_after_rise_pct / 100;

  if (s.status === 'holding') {
    if (price > s.high) s.high = price;
    const gainFromEntry = price / s.entry - 1;
    const dropFromHigh = price / s.high - 1; // <= 0

    if (gainFromEntry >= tp) {
      const proceeds = s.coin_units * price;
      const tradePnl = proceeds - s.coin_units * s.entry;
      s.realized_pnl += tradePnl;
      s.stable_usd = proceeds;
      s.coin_units = 0;
      s.status = 'parked';
      s.low = price;
      log.push({ t: nowISO(), asset: asset.ticker, event: 'TAKE_PROFIT', price, detail: `up ${pct(gainFromEntry)} from entry — locked ${usd(proceeds)} (trade ${pct(tradePnl / (proceeds - tradePnl))})` });
    } else if (dropFromHigh <= -trail) {
      const proceeds = s.coin_units * price;
      const tradePnl = proceeds - s.coin_units * s.entry;
      s.realized_pnl += tradePnl;
      s.stable_usd = proceeds;
      s.coin_units = 0;
      s.status = 'parked';
      s.low = price;
      log.push({ t: nowISO(), asset: asset.ticker, event: 'TRAILING_STOP', price, detail: `fell ${pct(dropFromHigh)} from high ${usd(s.high)} — exited to stable at ${usd(proceeds)}` });
    }
  } else { // parked in stable
    if (price < s.low) s.low = price;
    const riseFromLow = price / s.low - 1;
    if (riseFromLow >= rebuy) {
      s.coin_units = s.stable_usd / price;
      s.entry = price;
      s.high = price;
      s.stable_usd = 0;
      s.status = 'holding';
      log.push({ t: nowISO(), asset: asset.ticker, event: 'RE_ENTER', price, detail: `rose ${pct(riseFromLow)} off low ${usd(s.low)} — bought back in` });
    }
  }
}

function strategyValue(s, price) {
  return s.status === 'holding' ? s.coin_units * price : s.stable_usd;
}

async function run({ watch, reset }) {
  const cfg = loadJSON(CONFIG_PATH, null);
  if (!cfg) { console.error('Missing/invalid config.json'); process.exit(1); }

  let state = reset ? null : loadJSON(STATE_PATH, null);
  const ids = cfg.assets.map((a) => a.coingecko_id);

  async function tick() {
    let prices;
    try {
      prices = await fetchPrices(ids);
    } catch (e) {
      console.error(`[${nowISO()}] price fetch failed: ${e.message} — will retry next tick`);
      return;
    }

    // Initialize on first run: "buy" each asset at the current price + set the
    // buy-and-hold benchmark at the same starting point.
    if (!state) {
      state = { started_at: nowISO(), assets: {}, log: [] };
      for (const a of cfg.assets) {
        const price = prices[a.coingecko_id] && prices[a.coingecko_id].usd;
        if (!price) continue;
        state.assets[a.ticker] = {
          id: a.coingecko_id,
          alloc: a.paper_allocation_usd,
          first_price: price,
          hold_units: a.paper_allocation_usd / price, // buy-and-hold benchmark, never sold
          strat: {
            status: 'holding',
            entry: price,
            high: price,
            low: price,
            coin_units: a.paper_allocation_usd / price,
            stable_usd: 0,
            realized_pnl: 0,
          },
        };
      }
      state.log.push({ t: nowISO(), event: 'START', detail: `paper-test started — TP ${cfg.take_profit_pct}% / trail ${cfg.trailing_stop_pct}% / rebuy ${cfg.rebuy_after_rise_pct}%` });
    }

    // Step every asset.
    for (const a of cfg.assets) {
      const st = state.assets[a.ticker];
      const price = prices[a.coingecko_id] && prices[a.coingecko_id].usd;
      if (!st || !price) continue;
      step(a, st.strat, price, cfg, state.log);
    }
    saveJSON(STATE_PATH, state);

    // Dashboard.
    const lines = [];
    lines.push(`\n=== crypto-sim  ${nowISO()}  (PAPER — no real money) ===`);
    lines.push(`rules: take-profit +${cfg.take_profit_pct}% · trailing-stop -${cfg.trailing_stop_pct}% · re-enter +${cfg.rebuy_after_rise_pct}% off low`);
    let totStrat = 0, totHold = 0, totAlloc = 0;
    for (const a of cfg.assets) {
      const st = state.assets[a.ticker];
      const price = prices[a.coingecko_id] && prices[a.coingecko_id].usd;
      if (!st || !price) continue;
      const sval = strategyValue(st.strat, price);
      const hval = st.hold_units * price;
      totStrat += sval; totHold += hval; totAlloc += st.alloc;
      const where = st.strat.status === 'holding'
        ? `holding (entry ${usd(st.strat.entry)}, high ${usd(st.strat.high)})`
        : `PARKED in stable (waiting to re-enter, low ${usd(st.strat.low)})`;
      lines.push(
        `\n  ${a.ticker}  ${usd(price)}` +
        `\n    strategy:  ${usd(sval)}  (${pct(sval / st.alloc - 1)})  — ${where}` +
        `\n    hold-only: ${usd(hval)}  (${pct(hval / st.alloc - 1)})`
      );
    }
    const edge = totStrat - totHold;
    lines.push(`\n  TOTAL  strategy ${usd(totStrat)} (${pct(totStrat / totAlloc - 1)})  vs  hold ${usd(totHold)} (${pct(totHold / totAlloc - 1)})`);
    lines.push(`  strategy edge over holding: ${usd(edge)} (${edge >= 0 ? 'strategy ahead' : 'holding ahead'})`);

    // Recent events.
    const recent = state.log.slice(-5);
    if (recent.length) {
      lines.push(`\n  recent signals:`);
      for (const ev of recent) {
        lines.push(`    ${ev.t.slice(5, 16)}  ${ev.event}${ev.asset ? ' ' + ev.asset : ''}  ${ev.detail || ''}`);
      }
    }
    console.log(lines.join('\n'));
  }

  await tick();
  if (watch) {
    const ms = (cfg.poll_seconds || 300) * 1000;
    console.log(`\n…watching, polling every ${cfg.poll_seconds || 300}s. Ctrl-C to stop.`);
    setInterval(tick, ms);
  }
}

const args = process.argv.slice(2);
run({ watch: args.includes('--watch'), reset: args.includes('--reset') });
