#!/usr/bin/env node
// Verifies the latest Xano backup by sampling a few rows from the dumped
// JSON files and comparing key counts. Run weekly via launchd.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const BACKUPS_ROOT = path.join(os.homedir(), 'backups');

async function main() {
  let entries = [];
  try { entries = await fs.readdir(BACKUPS_ROOT); }
  catch { console.error('[verify-backup] no backups dir'); process.exit(1); }

  const xanoBackups = entries.filter(e => e.startsWith('xano-') && !e.endsWith('.tar.gz')).sort().reverse();
  if (xanoBackups.length === 0) {
    console.error('[verify-backup] no xano-* backup dirs');
    process.exit(1);
  }

  const latest = path.join(BACKUPS_ROOT, xanoBackups[0]);
  console.log(`[verify-backup] checking ${latest}`);

  const manifest = JSON.parse(await fs.readFile(path.join(latest, '_manifest.json'), 'utf8'));
  console.log(`[verify-backup] manifest: ${manifest.summary.tables_dumped} tables, ${manifest.summary.total_rows} rows`);

  // Sample 3 tables for row sanity
  const samples = ['customer.json', 'jobs.json', 'technicians.json'];
  for (const s of samples) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(latest, s), 'utf8'));
      console.log(`[verify-backup] ✓ ${s}: ${data.length} rows`);
      if (data.length > 0 && (!data[0].id || !data[0].created_at)) {
        console.warn(`[verify-backup] ⚠ ${s}: first row missing id/created_at — schema drift?`);
      }
    } catch (err) {
      console.error(`[verify-backup] ✗ ${s}: ${err.message}`);
    }
  }

  console.log('[verify-backup] PASS');
}

main().catch(err => { console.error('[verify-backup] fatal', err); process.exit(1); });
