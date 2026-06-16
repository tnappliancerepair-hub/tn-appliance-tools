// Parts daemon keep-alive watcher. launchd runs this every ~30 min. It pings the
// daemon's /health; if the daemon is down OR the Marcone/Amazon LIVE SESSION has
// logged out (the session dies when a window is closed or expires), it texts
// Teddy to re-log in. launchd keeps the PROCESS alive — this keeps the SESSION
// honest (a restart opens fresh, logged-OUT windows, so a human must re-login).
//
//   node watch.js
//
// Env: OWNER_PHONE_NUMBER, XANO_INTAKE_BASE, PARTS_PORT (optional).

'use strict';
const fs = require('fs');
const path = require('path');

const PORT_FILE = path.join(__dirname, '.daemon-port');
const STATE_FILE = path.join(__dirname, '.watch-state.json');
const OWNER = process.env.OWNER_PHONE_NUMBER || '+16154855795';
const XANO = process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const COOLDOWN_MS = 3 * 60 * 60 * 1000; // don't re-nag about the same problem within 3h

async function tryPort(p) {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`http://127.0.0.1:${p}/__version`, { signal: ctrl.signal });
    clearTimeout(t); return r.ok;
  } catch (_) { return false; }
}
async function resolveBase() {
  try { const p = Number(String(fs.readFileSync(PORT_FILE, 'utf8')).trim()); if (p && (await tryPort(p))) return `http://127.0.0.1:${p}`; } catch (_) {}
  const envP = Number(process.env.PARTS_PORT || 0); if (envP && (await tryPort(envP))) return `http://127.0.0.1:${envP}`;
  for (let p = 8787; p <= 8806; p++) { if (await tryPort(p)) return `http://127.0.0.1:${p}`; }
  return null;
}
function readState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; } }
function writeState(s) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (_) {} }

async function textOwner(message) {
  try {
    await fetch(`${XANO}/send_sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: OWNER, message, context: { recipient_role: 'owner', source: 'parts_daemon_watch' } }),
    });
  } catch (e) { console.error('[parts-watch] sms failed:', e.message || e); }
}

(async () => {
  const base = await resolveBase();
  let status, detail;
  if (!base) {
    status = 'offline';
    detail = 'Parts daemon is DOWN. On the Mac: cd colony-loop/parts && node serve.js (or it auto-restarts), then log into Marcone + Amazon.';
  } else {
    let health = {};
    try { health = await (await fetch(`${base}/health`)).json(); } catch (_) { health = { ok: false }; }
    if (health && health.healthy) {
      status = 'healthy';
    } else {
      status = 'session_down';
      const sup = (health && health.suppliers) || {};
      const down = Object.keys(sup).filter((k) => !sup[k].logged_in).join(', ') || 'marcone/amazon';
      detail = `Parts daemon is up but NOT logged in: ${down}. Log back into those windows ("Google Chrome for Testing") so part lookups work.`;
    }
  }

  const prev = readState();
  const now = Date.now();
  const sig = status; // alert keyed on status; changing status re-alerts immediately

  if (status === 'healthy') {
    // recovery note only if it was previously broken
    if (prev.status && prev.status !== 'healthy') {
      await textOwner('✅ Parts daemon healthy again — Marcone + Amazon logged in. Lookups working.');
    }
    writeState({ status, last_alert_ts: 0, ts: now });
    console.log('[parts-watch] healthy');
    return;
  }

  // problem state — alert if status changed OR cooldown elapsed
  const changed = prev.status !== sig;
  const cooled = !prev.last_alert_ts || (now - prev.last_alert_ts) > COOLDOWN_MS;
  if (changed || cooled) {
    await textOwner('⚠️ ' + detail);
    writeState({ status, last_alert_ts: now, ts: now });
    console.log('[parts-watch] alerted:', status);
  } else {
    writeState({ ...prev, status, ts: now });
    console.log('[parts-watch] problem (cooldown, no re-alert):', status);
  }
})().catch((e) => { console.error('[parts-watch] error:', e.message || e); process.exit(0); });
