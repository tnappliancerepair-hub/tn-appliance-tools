#!/usr/bin/env node
// Backup restore verification — runs monthly via launchd.
//
// Reads yesterday's backup JSON files (written by xano-backup.js),
// validates they parse as JSON, contain the expected tables, and
// have non-zero row counts where expected. Doesn't actually restore
// (no destination DB) — but proves the dump is well-formed enough
// that a restore would succeed.
//
// Without this, we have backups but no proof they work. Silent rot
// is the failure mode worth catching.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BACKUP_DIR_BASE = process.env.ANT_BACKUP_DIR || path.join(os.homedir(), 'backups');
const REQUIRED_TABLES = [
  'customer', 'jobs', 'technicians', 'event_log',
  'colony_signals', 'technician_decision_report',
];
const NON_EMPTY_TABLES = ['customer', 'jobs', 'technicians'];

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER_PHONE = process.env.OWNER_PHONE_NUMBER || '+16154855795';

function yyyymmdd(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

(async () => {
  // Find yesterday's backup directory
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  const dirName = `xano-${yyyymmdd(yesterday)}`;
  const dir = path.join(BACKUP_DIR_BASE, dirName);

  const checks = [];

  let exists = false;
  try { await fs.access(dir); exists = true; }
  catch (_) {}

  if (!exists) {
    return alert({
      ok: false,
      status: 'no_backup_dir',
      reason: `Expected backup at ${dir} — directory does not exist. xano-backup.js may have failed to run.`,
    });
  }

  let files = [];
  try { files = await fs.readdir(dir); }
  catch (e) {
    return alert({ ok: false, status: 'cannot_read_dir', reason: String(e.message || e) });
  }

  for (const tableName of REQUIRED_TABLES) {
    const matching = files.filter((f) => f.startsWith(tableName) && f.endsWith('.json'));
    if (matching.length === 0) {
      checks.push({ table: tableName, ok: false, reason: 'no file' });
      continue;
    }
    const file = path.join(dir, matching[0]);
    let parsed;
    try {
      const raw = await fs.readFile(file, 'utf8');
      parsed = JSON.parse(raw);
    } catch (e) {
      checks.push({ table: tableName, ok: false, reason: `parse failed: ${e.message}` });
      continue;
    }
    const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : []);
    if (NON_EMPTY_TABLES.includes(tableName) && rows.length === 0) {
      checks.push({ table: tableName, ok: false, reason: 'empty (should have rows)' });
      continue;
    }
    checks.push({ table: tableName, ok: true, row_count: rows.length });
  }

  const failed = checks.filter((c) => !c.ok);
  return alert({
    ok: failed.length === 0,
    status: failed.length === 0 ? 'verified' : 'verification_failed',
    dir: dirName,
    checks,
    failed_count: failed.length,
  });
})();

async function alert(result) {
  // Write audit row
  try {
    await fetch(`${XANO_BASE}/record_event_log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'backup_restore_verification',
        metadata_json: JSON.stringify(result),
      }),
    });
  } catch (_) {}

  // SMS only on failure
  if (!result.ok) {
    const body = `[ant] ⚠️ backup verification FAILED — ${result.reason || 'see audit'}. Dir: ${result.dir || 'unknown'}. Failed: ${result.failed_count || 0} tables.`;
    try {
      await fetch(`${XANO_BASE}/send_sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: OWNER_PHONE, message: body, context: { call_site: 'verify_backup_restorable' } }),
      });
    } catch (_) {}
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
