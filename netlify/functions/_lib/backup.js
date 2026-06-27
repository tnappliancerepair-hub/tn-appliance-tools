// Off-site backup core — reads Xano tables via the Metadata API and writes
// timestamped JSON snapshots to S3 (storage we own; same bucket attachments use).
// Runs entirely in the cloud (Netlify), so it does NOT depend on the Mac Mini
// (which is itself a single point of failure). This is Phase 0 of the money/data
// plan: the independent copy that makes retiring Google Sheets safe.
//
// CRITICAL vs the old Mac script (colony-loop/scripts/xano-backup.js): that one
// SKIPS event_log — but event_log is the money ledger (invoices, payments,
// add-ons, payouts). This one backs it up (chunked, so big tables don't blow
// memory or time).
'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const EVENT_LOG_TABLE = 3;
const PAGE_SIZE = 200;
const CHUNK_ROWS = 10000;   // rows per S3 object — bounds memory regardless of table size
const MAX_PAGES = 8000;     // runaway backstop (1.6M rows/table)

// Known table ids → friendly names. Unknown discovered ids fall back to table-<id>.
const NAME_MAP = { 3: 'event_log', 6: 'customer', 7: 'jobs', 15: 'technicians', 46: 'warranty_submissions', 47: 'parts_orders' };
// NEVER back these up: app_config (53) holds vault SECRETS; colony_signals (38) is the transient queue.
const SKIP_IDS = new Set([53, 38]);
// Money + business core we always include (probe discovers the rest).
const CORE_IDS = [7, 6, 3, 47, 46, 15];

function metaHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

function s3Client() {
  const region = process.env.TN_AWS_S3_REGION;
  const accessKeyId = process.env.TN_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.TN_AWS_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey || !process.env.TN_AWS_S3_BUCKET) {
    throw new Error('S3 not configured (TN_AWS_S3_REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY/S3_BUCKET)');
  }
  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

async function putJSON(client, key, obj) {
  await client.send(new PutObjectCommand({
    Bucket: process.env.TN_AWS_S3_BUCKET,
    Key: key,
    ContentType: 'application/json',
    Body: JSON.stringify(obj),
  }));
  return key;
}

// Page a table's content, flushing to onChunk() every CHUNK_ROWS rows.
async function pageTable(id, onChunk) {
  let total = 0, part = 0, buf = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let r;
    try {
      r = await fetch(`${META}/table/${id}/content/search`, {
        method: 'POST', headers: metaHeaders(),
        body: JSON.stringify({ per_page: PAGE_SIZE, page, sort: { id: 'asc' } }),
      });
    } catch (_) { break; }
    if (!r.ok) { if (page === 1) return { ok: false, status: r.status, total: 0, parts: 0 }; break; }
    const d = await r.json();
    const items = (d && d.items) || [];
    buf.push(...items); total += items.length;
    if (buf.length >= CHUNK_ROWS) { await onChunk(buf, part++); buf = []; }
    if (items.length < PAGE_SIZE) break;
  }
  if (buf.length) { await onChunk(buf, part++); }
  return { ok: true, total, parts: part };
}

// The metadata token is content-scoped (GET /table list returns 403), so we
// can't enumerate tables — probe a candidate id range and keep the ones that respond.
async function discoverIds() {
  const found = [];
  for (let id = 1; id <= 60; id++) {
    if (SKIP_IDS.has(id)) continue;
    try {
      const r = await fetch(`${META}/table/${id}/content/search`, {
        method: 'POST', headers: metaHeaders(), body: JSON.stringify({ per_page: 1, page: 1 }),
      });
      if (r.ok) found.push(id);
    } catch (_) {}
  }
  return found;
}

// Run a backup. opts.only = [ids] for a scoped run (probe/verify); else core+discovered.
async function backupTables(opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const root = (process.env.BACKUP_S3_PREFIX || 'backups/xano').replace(/\/+$/, '');
  const prefix = `${root}/${date}`;
  const client = s3Client();

  let ids = (opts.only && opts.only.length) ? opts.only : null;
  if (!ids) {
    const discovered = await discoverIds();
    ids = Array.from(new Set([...CORE_IDS, ...discovered])).filter((id) => !SKIP_IDS.has(id));
  }

  const summary = { date, started_at: new Date().toISOString(), tables: [], keys: [] };
  for (const id of ids) {
    const name = NAME_MAP[id] || ('table-' + id);
    const res = await pageTable(id, async (rows, part) => {
      const key = `${prefix}/${name}.part${String(part).padStart(3, '0')}.json`;
      await putJSON(client, key, { table: name, table_id: id, part, count: rows.length, rows });
      summary.keys.push(key);
    });
    summary.tables.push({ id, name, ok: res.ok, rows: res.total || 0, parts: res.parts || 0, status: res.status });
  }
  summary.finished_at = new Date().toISOString();
  summary.total_rows = summary.tables.reduce((s, t) => s + (t.rows || 0), 0);

  // manifest for this snapshot + a stable "latest" pointer
  await putJSON(client, `${prefix}/manifest.json`, summary);
  await putJSON(client, `${root}/latest.json`, {
    date, manifest: `${prefix}/manifest.json`, total_rows: summary.total_rows,
    tables: summary.tables.map((t) => ({ name: t.name, rows: t.rows })),
  });

  if (opts.writeAudit) {
    try {
      await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
        method: 'POST', headers: metaHeaders(),
        body: JSON.stringify({
          action: 'offsite_backup_completed',
          metadata: { date, total_rows: summary.total_rows, tables: summary.tables.length, bucket: process.env.TN_AWS_S3_BUCKET, prefix, at_ms: Date.now() },
        }),
      });
    } catch (_) {}
  }
  return summary;
}

module.exports = { backupTables };
