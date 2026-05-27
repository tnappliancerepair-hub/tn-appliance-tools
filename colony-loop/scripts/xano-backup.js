#!/usr/bin/env node
// Minimum-viable DR: daily Xano table snapshot.
//
// Lists all tables via Metadata API, paginates content for each, writes
// per-table JSON files to ~/backups/xano-YYYY-MM-DD/, then tars the
// snapshot directory into a single .tar.gz. Retains the last 14 daily
// snapshots locally; older directories + tars are removed.
//
// Optional S3 upload when both AWS env vars are set:
//   BACKUP_S3_BUCKET     — bucket name (e.g. "tn-appliance-backups")
//   BACKUP_S3_PREFIX     — optional key prefix (default "xano/")
// Skip tables that are high-churn / transient by adding them to the
// SKIP_TABLES set below.
//
// Run manually:   node colony-loop/scripts/xano-backup.js
// Run via launchd: see colony-loop/launchd/com.tnappliance.xano-backup.plist
//
// Writes an event_log audit row "xano_backup_completed" (or "xano_backup_failed")
// so the office calendar / activity feeds can verify daily success.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const BACKUPS_ROOT = path.join(os.homedir(), 'backups');
const RETENTION_DAYS = 14;
const PAGE_SIZE = 200;
const METADATA_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const INTAKE_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

// Skip tables that are either:
//  - too large & high-churn (event_log: append-only, churns thousands/day)
//  - transient (colony_signals: processed then GC'd)
//  - cache/derivative (regenerable from primary tables)
const SKIP_TABLES = new Set([
  'event_log',
  'colony_signals',
]);

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

async function metadataToken() {
  try {
    const raw = await fs.readFile(path.join(os.homedir(), '.xano/credentials.yaml'), 'utf8');
    const m = raw.match(/access_token:\s*([^\s]+)/);
    if (m) return m[1];
  } catch {
    // ignore
  }
  return process.env.XANO_METADATA_TOKEN || '';
}

async function listTables(token) {
  const res = await fetch(`${METADATA_BASE}/table`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`list tables failed (${res.status})`);
  const data = await res.json();
  // API may return {items: []} or [] directly depending on version
  const arr = Array.isArray(data) ? data : (data.items || []);
  return arr.map(t => ({ id: t.id, name: t.name }));
}

async function dumpTable(token, table, outDir) {
  let page = 1;
  let total = 0;
  const all = [];
  while (true) {
    const res = await fetch(`${METADATA_BASE}/table/${table.id}/content/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ search: {}, per_page: PAGE_SIZE, page }),
    });
    if (!res.ok) throw new Error(`dump ${table.name} page ${page} failed (${res.status})`);
    const data = await res.json();
    const items = data.items || [];
    if (items.length === 0) break;
    all.push(...items);
    total += items.length;
    if (items.length < PAGE_SIZE) break;
    page += 1;
    if (page > 1000) {
      console.warn(`[backup] ${table.name}: pagination cap hit at ${total} rows`);
      break;
    }
  }
  const filePath = path.join(outDir, `${table.name}.json`);
  await fs.writeFile(filePath, JSON.stringify(all, null, 2));
  return total;
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
    child.on('error', reject);
  });
}

async function tarSnapshot(snapshotDir) {
  const tarPath = `${snapshotDir}.tar.gz`;
  await runCmd('tar', ['-czf', tarPath, '-C', path.dirname(snapshotDir), path.basename(snapshotDir)]);
  return tarPath;
}

async function rmTree(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function pruneOld() {
  let entries = [];
  try {
    entries = await fs.readdir(BACKUPS_ROOT);
  } catch {
    return [];
  }
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const removed = [];
  for (const name of entries) {
    if (!name.startsWith('xano-')) continue;
    const full = path.join(BACKUPS_ROOT, name);
    try {
      const st = await fs.stat(full);
      if (st.mtimeMs < cutoff) {
        await rmTree(full);
        removed.push(name);
      }
    } catch {
      // ignore
    }
  }
  return removed;
}

async function uploadS3(tarPath) {
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) return { uploaded: false, reason: 'no_bucket_configured' };
  const prefix = (process.env.BACKUP_S3_PREFIX || 'xano/').replace(/^\/+|\/+$/g, '') + '/';
  const key = prefix + path.basename(tarPath);
  // Defer to AWS CLI if installed. Avoids pulling in @aws-sdk just for this.
  try {
    await runCmd('aws', ['s3', 'cp', tarPath, `s3://${bucket}/${key}`]);
    return { uploaded: true, bucket, key };
  } catch (err) {
    return { uploaded: false, reason: String(err.message || err) };
  }
}

async function logToXano(action, metadata) {
  try {
    await fetch(`${INTAKE_BASE}/emit_colony_signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signal_type: action.toUpperCase(),
        signal_strength: 10,
        source_colony: 'mac-mini-tn',
        payload: JSON.stringify(metadata),
      }),
    });
  } catch (err) {
    console.warn('[backup] emit_colony_signal failed (non-fatal):', err.message);
  }
}

async function main() {
  await loadEnv();
  const token = await metadataToken();
  if (!token) {
    console.error('[backup] no XANO_METADATA_TOKEN available — cannot read tables');
    process.exit(1);
  }

  await fs.mkdir(BACKUPS_ROOT, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const snapshotDir = path.join(BACKUPS_ROOT, `xano-${today}`);
  await fs.mkdir(snapshotDir, { recursive: true });

  const started = Date.now();
  console.log(`[backup] starting snapshot → ${snapshotDir}`);

  let tables;
  try {
    tables = await listTables(token);
  } catch (err) {
    console.error('[backup] list tables failed:', err.message);
    await logToXano('xano_backup_failed', { reason: 'list_tables_failed', error: err.message });
    process.exit(1);
  }
  console.log(`[backup] discovered ${tables.length} tables`);

  const results = [];
  for (const t of tables) {
    if (SKIP_TABLES.has(t.name)) {
      console.log(`[backup] skip ${t.name} (skip-list)`);
      continue;
    }
    try {
      const n = await dumpTable(token, t, snapshotDir);
      results.push({ table: t.name, rows: n });
      console.log(`[backup] ✓ ${t.name}: ${n} rows`);
    } catch (err) {
      results.push({ table: t.name, rows: 0, error: String(err.message || err) });
      console.warn(`[backup] ✗ ${t.name}: ${err.message}`);
    }
  }

  let tarPath = null;
  try {
    tarPath = await tarSnapshot(snapshotDir);
    console.log(`[backup] tarred → ${tarPath}`);
  } catch (err) {
    console.warn('[backup] tar failed:', err.message);
  }

  const s3Result = tarPath ? await uploadS3(tarPath) : { uploaded: false, reason: 'no_tar' };
  if (s3Result.uploaded) {
    console.log(`[backup] uploaded → s3://${s3Result.bucket}/${s3Result.key}`);
  } else {
    console.log(`[backup] s3 skipped: ${s3Result.reason}`);
  }

  const pruned = await pruneOld();
  if (pruned.length) console.log(`[backup] pruned ${pruned.length} old snapshot(s)`);

  const totalRows = results.reduce((a, r) => a + (r.rows || 0), 0);
  const failures = results.filter(r => r.error);
  const summary = {
    date: today,
    started_ms: started,
    ended_ms: Date.now(),
    duration_ms: Date.now() - started,
    tables_dumped: results.length - failures.length,
    tables_failed: failures.length,
    total_rows: totalRows,
    s3_uploaded: s3Result.uploaded,
    snapshot_path: snapshotDir,
    tar_path: tarPath,
    pruned: pruned.length,
  };

  await fs.writeFile(
    path.join(snapshotDir, '_manifest.json'),
    JSON.stringify({ summary, results }, null, 2)
  );

  await logToXano(
    failures.length ? 'xano_backup_partial' : 'xano_backup_completed',
    summary
  );

  console.log(`[backup] done in ${(summary.duration_ms / 1000).toFixed(1)}s — ${totalRows} rows across ${summary.tables_dumped} tables`);
  process.exit(failures.length ? 2 : 0);
}

main().catch(err => {
  console.error('[backup] fatal:', err);
  process.exit(1);
});
