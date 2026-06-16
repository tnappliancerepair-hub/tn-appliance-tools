// Local SQLite store for the colony loop — the foundation of moving the loop's
// plumbing OFF Xano (2026-06-16, after a night of Xano 502s caused by the loop
// using Xano as a message queue + high-churn event log).
//
// This module is a DROP-IN replacement for the signal-queue / dedup / event-log
// functions in xano.js. Same names, same signatures, same return shapes — so the
// cutover is a one-line import swap (or a LOOP_STORE=local router). Business data
// (jobs, customers, money) stays in Xano; only the loop's working memory lives
// here: the signal queue, dedup markers, and the noisy plumbing event log.
//
// better-sqlite3 is synchronous + microsecond-fast + a single file. The exported
// functions are async only to match xano.js's signatures (await on a value is a
// no-op), so callers don't change.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Standalone on purpose — no config.js import (which hard-requires Xano env vars),
// so the local store works/tests even when Xano isn't configured.
const COLONY_NAME = process.env.COLONY_NAME || 'mac-mini-tn';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.LOOP_DB_PATH || join(__dirname, 'loop.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');   // concurrent reads + durable, fast writes
db.pragma('synchronous = NORMAL'); // good durability without fsync-per-write cost

db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_type     TEXT NOT NULL,
    signal_strength INTEGER DEFAULT 50,
    source_colony   TEXT,
    target_colonies TEXT DEFAULT '',
    payload         TEXT DEFAULT '{}',
    result_action   TEXT,
    origin          TEXT DEFAULT 'local',   -- 'local' (loop-emitted) | 'inbox' (pulled from Xano)
    inbox_ref       TEXT,                   -- the Xano colony_signals id, when origin='inbox'
    created_at      INTEGER NOT NULL,
    processed_at    INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_signals_pending      ON signals (processed_at, created_at);
  CREATE INDEX IF NOT EXISTS idx_signals_type_pending ON signals (signal_type, processed_at);
  CREATE INDEX IF NOT EXISTS idx_signals_inbox_ref    ON signals (inbox_ref);

  CREATE TABLE IF NOT EXISTS fired_markers (
    action     TEXT NOT NULL,
    day_key    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(action, day_key)
  );

  CREATE TABLE IF NOT EXISTS event_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    action        TEXT NOT NULL,
    metadata_json TEXT DEFAULT '{}',
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_event_log_action ON event_log (action, created_at);
`);

// ── prepared statements (compiled once) ──────────────────────────────────────
const stmt = {
  pending:        db.prepare(`SELECT id, signal_type, signal_strength, source_colony, target_colonies, payload, origin, created_at, processed_at FROM signals WHERE processed_at IS NULL ORDER BY created_at ASC LIMIT ?`),
  insertSignal:   db.prepare(`INSERT INTO signals (signal_type, signal_strength, source_colony, target_colonies, payload, origin, inbox_ref, created_at) VALUES (@signal_type, @signal_strength, @source_colony, @target_colonies, @payload, @origin, @inbox_ref, @created_at)`),
  markProcessed:  db.prepare(`UPDATE signals SET processed_at = @now, result_action = @result_action WHERE id = @id AND processed_at IS NULL`),
  countForJob:    db.prepare(`SELECT COUNT(*) AS n FROM signals WHERE processed_at IS NULL AND signal_type = ? AND CAST(json_extract(payload, '$.job_id') AS TEXT) = CAST(? AS TEXT)`),
  inboxSeen:      db.prepare(`SELECT 1 FROM signals WHERE inbox_ref = ? LIMIT 1`),
  fired:          db.prepare(`SELECT 1 FROM fired_markers WHERE action = ? AND day_key = ? LIMIT 1`),
  markFired:      db.prepare(`INSERT OR IGNORE INTO fired_markers (action, day_key, created_at) VALUES (?, ?, ?)`),
  insertEvent:    db.prepare(`INSERT INTO event_log (action, metadata_json, created_at) VALUES (?, ?, ?)`),
  pendingCount:   db.prepare(`SELECT COUNT(*) AS n FROM signals WHERE processed_at IS NULL`),
  gcSignals:      db.prepare(`DELETE FROM signals WHERE processed_at IS NOT NULL AND processed_at < ?`),
  gcEvents:       db.prepare(`DELETE FROM event_log WHERE created_at < ?`),
};

// ── trace ids + outcome classification (mirrors xano.js so logs match) ───────
export function newTraceId() {
  return 'tr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function classifyOutcome(resultAction) {
  const s = String(resultAction || '').toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('error') || s.includes('failed') || s.includes('crashed')) return 'errored';
  if (
    s.includes('skipped') || s.includes('no_op') || s.includes('deferred') ||
    s.includes('gated') || s.includes('duplicate') || s.includes('ttl_expired') ||
    s.includes('no_agent_yet') || s.includes('already')
  ) return 'skipped';
  return 'succeeded';
}

export function logLocal(action, metadata = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), action, ...metadata }));
}

// ── signal queue (drop-in for xano.js) ───────────────────────────────────────
export async function fetchPendingSignals(limit = 50) {
  return stmt.pending.all(limit);
}

export async function emitSignal({ signal_type, signal_strength = 50, source_colony, target_colonies = '', payload = {}, trace_id = '', _origin = 'local', _inbox_ref = null }) {
  let payloadObj;
  if (typeof payload === 'string') {
    try { payloadObj = JSON.parse(payload); } catch (_) { payloadObj = { _raw: payload }; }
  } else {
    payloadObj = { ...payload };
  }
  if (!payloadObj.trace_id) payloadObj.trace_id = trace_id || newTraceId();
  const info = stmt.insertSignal.run({
    signal_type,
    signal_strength,
    source_colony: source_colony || COLONY_NAME,
    target_colonies,
    payload: JSON.stringify(payloadObj),
    origin: _origin,
    inbox_ref: _inbox_ref,
    created_at: Date.now(),
  });
  return { id: Number(info.lastInsertRowid), signal_type, success: true };
}

export async function markSignalProcessed(signalId, resultAction, resultObj = {}, opts = {}) {
  stmt.markProcessed.run({ now: Date.now(), result_action: resultAction || '', id: signalId });
  // The categorized sibling row (succeeded/skipped/errored) — local + cheap.
  const outcomeClass = opts.outcome_class || classifyOutcome(resultAction);
  try {
    stmt.insertEvent.run(
      `signal_outcome_${outcomeClass}`,
      JSON.stringify({ signal_id: signalId, result_action: resultAction || '', outcome_class: outcomeClass, ...(resultObj || {}), _ctx: undefined }),
      Date.now(),
    );
  } catch (_) {}
  return { success: true };
}

export async function countPendingSignalsForJob(signalType, jobId) {
  const row = stmt.countForJob.get(signalType, jobId);
  return { success: true, pending_count: (row && row.n) || 0 };
}

// ── dedup (drop-in) — now PERSISTENT + local + instant, no Xano 502 ──────────
export function markFiredThisProcess(action, dayKey) {
  if (action == null || dayKey == null) return;
  stmt.markFired.run(String(action), String(dayKey), Date.now());
}

export async function checkEventLogFiredToday(action, dayKey) {
  return !!stmt.fired.get(String(action || ''), String(dayKey || ''));
}

// ── event log (drop-in) — the high-churn plumbing rows stay local ────────────
export async function recordEventLog(action, metadata = {}) {
  stmt.insertEvent.run(String(action || ''), JSON.stringify(metadata || {}), Date.now());
  return { success: true };
}

export async function recordEvent(action, metadata = {}) {
  if (metadata && metadata.day != null) markFiredThisProcess(action, metadata.day);
  return recordEventLog(action, metadata);
}

// ── inbox helper (for the cutover's external-producer drain) ─────────────────
// Insert a signal pulled from Xano colony_signals, idempotently (skip if its
// Xano id was already pulled). Returns true if newly inserted.
export async function ingestInboxSignal(xanoRow) {
  const ref = String(xanoRow.id);
  if (stmt.inboxSeen.get(ref)) return false;
  await emitSignal({
    signal_type: xanoRow.signal_type,
    signal_strength: xanoRow.signal_strength || 50,
    source_colony: xanoRow.source_colony || 'external',
    target_colonies: xanoRow.target_colonies || '',
    payload: xanoRow.payload || '{}',
    _origin: 'inbox',
    _inbox_ref: ref,
  });
  return true;
}

// ── housekeeping / diagnostics ───────────────────────────────────────────────
export function gc({ processedOlderThanMs = 24 * 3600 * 1000, eventsOlderThanMs = 7 * 24 * 3600 * 1000 } = {}) {
  const now = Date.now();
  const s = stmt.gcSignals.run(now - processedOlderThanMs).changes;
  const e = stmt.gcEvents.run(now - eventsOlderThanMs).changes;
  return { signals_deleted: s, events_deleted: e };
}

export function stats() {
  const pending = stmt.pendingCount.get().n;
  const markers = db.prepare('SELECT COUNT(*) AS n FROM fired_markers').get().n;
  const events = db.prepare('SELECT COUNT(*) AS n FROM event_log').get().n;
  return { db_path: DB_PATH, pending_signals: pending, fired_markers: markers, event_log_rows: events };
}

export function _db() { return db; } // escape hatch for scripts/tests
