#!/usr/bin/env node
// Backfill embeddings for existing TDRs, customer notes, and chat messages.
// Run on-demand: node colony-loop/scripts/backfill-embeddings.js [--ns=tdr] [--max=500]
//
// For each row: POSTs to /.netlify/functions/embed-text which embeds +
// persists to the embeddings table.

const XANO_INTAKE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const EMBED_FN = 'https://tnapplianceexchange.net/.netlify/functions/embed-text';
const META_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';

const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2).reduce((a, x) => {
  const m = x.match(/^--([\w-]+)=?(.*)$/);
  if (m) a[m[1]] = m[2] || true;
  return a;
}, {});

const NS_FILTER = args['ns'] || null;
const MAX = Number(args['max'] || 200);

async function getMetadataToken() {
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.xano/credentials.yaml'), 'utf8');
    const m = raw.match(/access_token:\s*([^\s]+)/);
    if (m) return m[1];
  } catch {}
  return process.env.XANO_METADATA_TOKEN || '';
}

async function embedAndPersist(text, sourceTable, sourceRowId, namespace) {
  if (!text || text.trim().length < 10) return { skipped: true, reason: 'text_too_short' };
  const res = await fetch(EMBED_FN, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      text, source_table: sourceTable, source_row_id: sourceRowId,
      company_id: 1, namespace,
    }),
  });
  return res.json();
}

async function backfillTdr(token) {
  console.log('[backfill] tdr...');
  const res = await fetch(`${META_BASE}/table/12/content/search`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ search: {}, per_page: MAX, page: 1 }),
  });
  const data = await res.json();
  const items = data.items || [];
  console.log(`  ${items.length} TDR rows`);
  let n = 0;
  for (const row of items) {
    const text = [row.diagnosis, row.failure_cause, row.failed_component, row.repair_completed].filter(Boolean).join(' | ');
    if (text.trim().length < 10) continue;
    await embedAndPersist(text, 'technician_decision_report', row.id, 'tdr');
    n++;
    if (n % 25 === 0) console.log(`  [${n}/${items.length}]`);
  }
  console.log(`  done — ${n} embeddings persisted`);
}

async function backfillCustomerNotes(token) {
  console.log('[backfill] customer notes...');
  const res = await fetch(`${META_BASE}/table/6/content/search`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ search: {}, per_page: MAX, page: 1 }),
  });
  const data = await res.json();
  const items = (data.items || []).filter(r => r.notes && r.notes.trim().length > 10);
  console.log(`  ${items.length} customer rows with notes`);
  let n = 0;
  for (const row of items) {
    await embedAndPersist(row.notes, 'customer', row.id, 'customer_notes');
    n++;
  }
  console.log(`  done — ${n} embeddings persisted`);
}

async function main() {
  const token = await getMetadataToken();
  if (!token) { console.error('[backfill] no metadata token'); process.exit(1); }

  if (!NS_FILTER || NS_FILTER === 'tdr') await backfillTdr(token);
  if (!NS_FILTER || NS_FILTER === 'customer_notes') await backfillCustomerNotes(token);

  console.log('[backfill] all done');
}
main().catch(err => { console.error('[backfill] fatal', err); process.exit(1); });
