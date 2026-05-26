#!/usr/bin/env node
// Standalone colony-loop healthcheck. Run via launchd every 10 minutes.
// Queries Xano event_log for the most recent colony_loop_heartbeat row;
// if older than STALE_MINUTES (default 10), pages Teddy via SMS.
//
// Designed to be SEPARATE from the colony loop's own process — so a hung
// or crashed loop can't suppress its own alarm. Runs from launchd label
// com.tnappliance.colony-healthcheck.plist.
//
// ENV (from colony-loop/.env or launchd plist):
//   XANO_INTAKE_BASE     (required) — Xano api group URL
//   XANO_METADATA_TOKEN  (required) — JWT for Metadata API content/search
//   OWNER_PHONE_NUMBER   (required) — Teddy's phone for the alert (E.164)
//   STALE_MINUTES        optional, defaults to 10
//   COOLDOWN_MINUTES     optional, defaults to 30 (don't double-page within this window)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const STATE_PATH = path.join(os.homedir(), '.colony-healthcheck-state.json');

async function loadEnv() {
  try {
    const raw = await fs.readFile(path.join(REPO_ROOT, 'colony-loop/.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env optional
  }
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
  } catch {
    return { last_alert_at_ms: 0 };
  }
}

async function writeState(s) {
  await fs.writeFile(STATE_PATH, JSON.stringify(s, null, 2));
}

async function fetchMetadataToken() {
  // Try to read the same token the Xano CLI stores at ~/.xano/credentials.yaml.
  // Falls back to env var if the file is unreadable.
  try {
    const raw = await fs.readFile(path.join(os.homedir(), '.xano/credentials.yaml'), 'utf8');
    const m = raw.match(/access_token:\s*([^\s]+)/);
    if (m) return m[1];
  } catch {
    // ignore
  }
  return process.env.XANO_METADATA_TOKEN || '';
}

async function getLatestHeartbeat(metadataToken) {
  // event_log table is id=3 per session memory.
  const res = await fetch('https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1/table/3/content/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${metadataToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ search: { action: 'colony_loop_heartbeat' }, per_page: 50 }),
  });
  if (!res.ok) throw new Error(`metadata search HTTP ${res.status}`);
  const data = await res.json();
  const items = (data && data.items) || [];
  if (items.length === 0) return null;
  // The search doesn't sort by recency by default; find max(created_at) ourselves.
  let latest = items[0];
  for (const it of items) {
    if ((it.created_at || 0) > (latest.created_at || 0)) latest = it;
  }
  return latest;
}

async function pageTeddy(message) {
  const xanoBase = process.env.XANO_INTAKE_BASE;
  const phone = process.env.OWNER_PHONE_NUMBER;
  if (!xanoBase || !phone) {
    console.error('  cannot page: XANO_INTAKE_BASE or OWNER_PHONE_NUMBER missing');
    return false;
  }
  const res = await fetch(`${xanoBase}/send_sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: phone, message }),
  });
  return res.ok;
}

async function main() {
  await loadEnv();

  const staleMinutes = parseInt(process.env.STALE_MINUTES || '10', 10);
  const cooldownMinutes = parseInt(process.env.COOLDOWN_MINUTES || '30', 10);
  const nowMs = Date.now();

  const metadataToken = await fetchMetadataToken();
  if (!metadataToken) {
    console.error('  no Xano metadata token available; cannot run healthcheck');
    process.exit(2);
  }

  let latest;
  try {
    latest = await getLatestHeartbeat(metadataToken);
  } catch (err) {
    console.error(`  metadata API failed: ${err.message}`);
    // If we can't reach Xano at all, page Teddy. Either his Mac Mini is offline,
    // his internet is down, or Xano is down — all worth knowing.
    const state = await readState();
    if (nowMs - (state.last_alert_at_ms || 0) > cooldownMinutes * 60 * 1000) {
      await pageTeddy('🚨 [ant] healthcheck failed — Xano metadata API unreachable from Mac Mini. Check colony-loop / network / Xano status.');
      state.last_alert_at_ms = nowMs;
      await writeState(state);
    }
    process.exit(1);
  }

  if (!latest) {
    console.log('  no colony_loop_heartbeat rows in event_log yet — loop may be newly deployed');
    const state = await readState();
    if (nowMs - (state.last_alert_at_ms || 0) > cooldownMinutes * 60 * 1000) {
      await pageTeddy('🚨 [ant] colony loop appears down - no heartbeat in event_log. Check Mac Mini.');
      state.last_alert_at_ms = nowMs;
      await writeState(state);
    }
    process.exit(1);
  }

  const ageMs = nowMs - (latest.created_at || 0);
  const ageMin = Math.round(ageMs / 60000);
  console.log(`  latest heartbeat event_id=${latest.id}  age=${ageMin}min`);

  if (ageMs > staleMinutes * 60 * 1000) {
    const state = await readState();
    if (nowMs - (state.last_alert_at_ms || 0) > cooldownMinutes * 60 * 1000) {
      const msg = `🚨 [ant] colony loop appears down - no heartbeat in ${ageMin} min (last event_id=${latest.id}). Check Mac Mini.`;
      const sent = await pageTeddy(msg);
      console.log(`  ALERT SENT: ${sent ? 'ok' : 'failed'} — ${msg}`);
      state.last_alert_at_ms = nowMs;
      await writeState(state);
    } else {
      const cooldownLeftMin = Math.round((cooldownMinutes * 60 * 1000 - (nowMs - state.last_alert_at_ms)) / 60000);
      console.log(`  STALE but in cooldown (${cooldownLeftMin}min left)`);
    }
    process.exit(1);
  }

  console.log('  loop is healthy');
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL', err.stack || err.message || err);
  process.exit(1);
});
