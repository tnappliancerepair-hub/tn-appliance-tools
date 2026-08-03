// Postgres store for the colony loop — the Phase-2 shadow spine (LOCKED Decision
// #1: queue + dedup + event_log on Supabase Postgres). DROP-IN for db.js /
// xano.js's queue+dedup+event functions: same names, signatures, and return
// shapes, so the cutover is a one-line router swap (LOOP_STORE=pg in store.js).
//
// Dependency-free on PURPOSE — talks to Supabase over PostgREST via global fetch
// (same ethos as db.js using node:sqlite: no npm install, no native build). The
// loop process (Mac/Railway) reads SUPABASE_URL + SUPABASE_SERVICE_KEY from env;
// the service key bypasses RLS (server-side only — never ship it to a browser).
//
// Schema: docs/sql/003_loop_spine.sql (loop_signals / loop_fired_markers /
// loop_events). Timestamps are unix-ms bigints to match db.js byte-for-byte.
//
// Async everywhere (network) — matches xano.js's async signatures.

const COLONY_NAME = process.env.COLONY_NAME || 'cloud-shadow';

// ── config / transport ───────────────────────────────────────────────────────
const URL_ = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY_ = () => String(process.env.SUPABASE_SERVICE_KEY || '');
export function isConfigured() { return !!(URL_() && KEY_()); }

function authHeaders(extra) {
  const key = KEY_();
  return { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json', ...(extra || {}) };
}

// Core request. Returns parsed JSON (or null on 204 / non-JSON). Throws on non-2xx.
async function req(method, path, body, extraHeaders) {
  const url = URL_(), key = KEY_();
  if (!url || !key) throw new Error('pg_not_configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  const headers = authHeaders(extraHeaders);
  if (body != null) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method, headers,
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`pg ${method} ${path.split('?')[0]} -> ${r.status}: ${t.slice(0, 160)}`);
  }
  if (r.status === 204) return null;
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : null;
}

// A read that returns the exact-count from PostgREST's Content-Range header.
async function reqCount(path) {
  const url = URL_(), key = KEY_();
  if (!url || !key) throw new Error('pg_not_configured');
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method: 'GET', headers: authHeaders({ Prefer: 'count=exact', Range: '0-0' }),
    signal: AbortSignal.timeout(12000),
  });
  const range = r.headers.get('content-range') || '';   // "0-0/842" or "*/842"
  return Number((range.split('/')[1] || '0')) || 0;
}

// A delete that returns how many rows it removed (count=exact).
async function delCount(path) {
  const url = URL_(), key = KEY_();
  if (!url || !key) throw new Error('pg_not_configured');
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method: 'DELETE', headers: authHeaders({ Prefer: 'count=exact,return=minimal' }),
    signal: AbortSignal.timeout(20000),
  });
  const range = r.headers.get('content-range') || '';
  return Number((range.split('/')[1] || '0')) || 0;
}

// ── trace ids + outcome classification (copied from db.js so logs match) ─────
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

// ── signal queue (drop-in for db.js / xano.js) ───────────────────────────────
export async function fetchPendingSignals(limit = 50) {
  const now = Date.now();
  const qs = new URLSearchParams({
    processed_at: 'is.null',
    or: `(process_after.is.null,process_after.lte.${now})`,   // deadline-aware: future signals stay asleep
    order: 'created_at.asc',
    limit: String(limit),
    select: 'id,signal_type,signal_strength,source_colony,target_colonies,payload,origin,created_at,processed_at',
  });
  const rows = await req('GET', `loop_signals?${qs.toString()}`);
  // db.js returns payload as a JSON STRING (TEXT column); callers JSON.parse it.
  // PostgREST returns jsonb as an object — stringify back so we stay a true drop-in.
  return (rows || []).map((r) => ({ ...r, payload: typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload ?? {}) }));
}

export async function emitSignal({ signal_type, signal_strength = 50, source_colony, target_colonies = '', payload = {}, trace_id = '', _origin = 'shadow', _inbox_ref = null }) {
  let payloadObj;
  if (typeof payload === 'string') {
    try { payloadObj = JSON.parse(payload); } catch (_) { payloadObj = { _raw: payload }; }
  } else {
    payloadObj = { ...payload };
  }
  if (!payloadObj.trace_id) payloadObj.trace_id = trace_id || newTraceId();
  const jobId = payloadObj.job_id == null ? null : String(payloadObj.job_id);
  const processAfter = Number(payloadObj.process_after_ms ?? payloadObj.deadline_ms ?? payloadObj.scheduled_for_ms ?? 0) || null;
  const row = {
    signal_type,
    signal_strength,
    source_colony: source_colony || COLONY_NAME,
    target_colonies,
    payload: payloadObj,
    job_id: jobId,
    origin: _origin,
    inbox_ref: _inbox_ref,
    process_after: processAfter,
    created_at: Date.now(),
  };
  const out = await req('POST', 'loop_signals?select=id', row, { Prefer: 'return=representation' });
  const id = Array.isArray(out) && out[0] ? Number(out[0].id) : null;
  return { id, signal_type, success: true };
}

export async function markSignalProcessed(signalId, resultAction, resultObj = {}, opts = {}) {
  // Only claim it if still pending (processed_at is.null) — idempotent, no double-fire.
  await req('PATCH', `loop_signals?id=eq.${Number(signalId)}&processed_at=is.null`,
    { processed_at: Date.now(), result_action: resultAction || '' }, { Prefer: 'return=minimal' });
  const outcomeClass = opts.outcome_class || classifyOutcome(resultAction);
  try {
    await recordEventLog(`signal_outcome_${outcomeClass}`, {
      signal_id: signalId, result_action: resultAction || '', outcome_class: outcomeClass, ...(resultObj || {}),
    });
  } catch (_) {}
  return { success: true };
}

export async function countPendingSignalsForJob(signalType, jobId) {
  const qs = new URLSearchParams({
    processed_at: 'is.null',
    signal_type: `eq.${signalType}`,
    job_id: `eq.${jobId == null ? '' : String(jobId)}`,
    select: 'id',
  });
  const count = await reqCount(`loop_signals?${qs.toString()}`);
  return { success: true, pending_count: count };
}

// ── dedup (drop-in) ──────────────────────────────────────────────────────────
// NOTE: async here (network) vs db.js's sync marker write — callers that fire
// without await get best-effort; the shadow is a single consumer so the tiny
// mark→check race is acceptable (and the unique key makes the write idempotent).
export async function markFiredThisProcess(action, dayKey) {
  if (action == null || dayKey == null) return;
  try {
    await req('POST', 'loop_fired_markers',
      { action: String(action), day_key: String(dayKey), created_at: Date.now() },
      { Prefer: 'return=minimal,resolution=ignore-duplicates' });
  } catch (_) {}
}

export async function checkEventLogFiredToday(action, dayKey) {
  const qs = new URLSearchParams({ action: `eq.${action || ''}`, day_key: `eq.${dayKey || ''}`, select: 'action', limit: '1' });
  const rows = await req('GET', `loop_fired_markers?${qs.toString()}`);
  return Array.isArray(rows) && rows.length > 0;
}

// ── event log (drop-in) ──────────────────────────────────────────────────────
export async function recordEventLog(action, metadata = {}) {
  try {
    await req('POST', 'loop_events', { action: String(action || ''), metadata: metadata || {}, created_at: Date.now() }, { Prefer: 'return=minimal' });
  } catch (_) {}
  return { success: true };
}

export async function recordEvent(action, metadata = {}) {
  if (metadata && metadata.day != null) await markFiredThisProcess(action, metadata.day);
  return recordEventLog(action, metadata);
}

// ── inbox helper (external-producer drain) ───────────────────────────────────
export async function ingestInboxSignal(xanoRow) {
  const ref = String(xanoRow.id);
  const seen = await req('GET', `loop_signals?inbox_ref=eq.${encodeURIComponent(ref)}&select=id&limit=1`);
  if (Array.isArray(seen) && seen.length) return false;
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
export async function gc({ processedOlderThanMs = 24 * 3600 * 1000, eventsOlderThanMs = 7 * 24 * 3600 * 1000 } = {}) {
  const now = Date.now();
  const s = await delCount(`loop_signals?processed_at=not.is.null&processed_at=lt.${now - processedOlderThanMs}`);
  const e = await delCount(`loop_events?created_at=lt.${now - eventsOlderThanMs}`);
  return { signals_deleted: s, events_deleted: e };
}

export async function stats() {
  const [pending, markers, events] = await Promise.all([
    reqCount('loop_signals?processed_at=is.null&select=id').catch(() => 0),
    reqCount('loop_fired_markers?select=action').catch(() => 0),
    reqCount('loop_events?select=id').catch(() => 0),
  ]);
  return { store: 'pg', pending_signals: pending, fired_markers: markers, event_log_rows: events };
}
