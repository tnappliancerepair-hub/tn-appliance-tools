// Guards the Phase-2 Postgres shadow store (colony-loop/pg.js): it must expose the
// same queue/dedup/event interface as db.js, and be no-op-safe (clear error, never
// a silent hang) when SUPABASE creds are absent. Pure — no network, no live creds.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const REQUIRED = [
  'isConfigured', 'newTraceId', 'logLocal',
  'fetchPendingSignals', 'emitSignal', 'markSignalProcessed', 'countPendingSignalsForJob',
  'markFiredThisProcess', 'checkEventLogFiredToday', 'recordEventLog', 'recordEvent',
  'ingestInboxSignal', 'gc', 'stats',
];

test('pg.js exposes the full db.js queue/dedup/event interface', async () => {
  const pg = await import('../colony-loop/pg.js');
  for (const fn of REQUIRED) assert.equal(typeof pg[fn], 'function', `missing export: ${fn}`);
});

test('pg.js is no-op-safe when creds absent (isConfigured=false; queue calls throw a clear error, never hang)', async () => {
  const savedUrl = process.env.SUPABASE_URL, savedKey = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  const pg = await import('../colony-loop/pg.js');
  assert.equal(pg.isConfigured(), false);
  await assert.rejects(() => pg.fetchPendingSignals(1), /pg_not_configured/);
  if (savedUrl) process.env.SUPABASE_URL = savedUrl;
  if (savedKey) process.env.SUPABASE_SERVICE_KEY = savedKey;
});

test('newTraceId is prefixed + unique-ish', async () => {
  const pg = await import('../colony-loop/pg.js');
  const a = pg.newTraceId(), b = pg.newTraceId();
  assert.match(a, /^tr_/);
  assert.notEqual(a, b);
});
