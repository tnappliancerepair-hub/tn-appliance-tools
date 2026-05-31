// Handles OPERATOR_STATUS_BRIEFING signals (emitted daily 7am CT by tick.js).
//
// Sends Teddy a single-SMS digest of production system health at the
// start of his day:
//
//   [ant] 7am status Sat Jun 7
//   loop fresh (2m heartbeat)
//   queue: 3 pending, 8 completed /24h, 0 stuck
//   broadcasts: 5 fired, 4 claimed /24h
//   errors: 0
//   intake: 12 jobs /24h (8 ahs, 4 chat)
//   Tier 1: ACTIVE (or PENDING — paste scheduler-1 to wake scheduler)
//
// Replaces nothing. Sits alongside daily_briefing (8am — task-focused)
// and office_morning_briefing (8am — Danielle-focused). This one is
// system-health-focused and fires earliest so Teddy gets the operating
// truth before he sees the task surface.
//
// Skips on weekend? No — Teddy reads it every day to stay oriented.
// Dedup: tick.js dedups via get_operator_status_fired_today before emit.

import { toOwner } from '../sms.js';
import { config } from '../config.js';

const NOW_MS = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const META_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';

const TABLES = {
  scheduling_queue: 25,
  broadcast_attempt: 23,
  event_log: 3,
  jobs: 7,
};

// ─────────────────────────────────────────────────────────────
// Metadata API helpers (read-only)
// ─────────────────────────────────────────────────────────────
async function metaFetch(pathSuffix) {
  const token = process.env.XANO_METADATA_TOKEN || '';
  const url = `${META_BASE}${pathSuffix}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`meta ${pathSuffix} → HTTP ${r.status}`);
  return r.json();
}

async function getLastPageItems(tableId, perPage = 2000) {
  const meta = await metaFetch(`/table/${tableId}/content?page=1&per_page=${perPage}`);
  const lastPage = meta.pageTotal || 1;
  if (lastPage === 1) return meta.items || [];
  const last = await metaFetch(`/table/${tableId}/content?page=${lastPage}&per_page=${perPage}`);
  return last.items || [];
}

// ─────────────────────────────────────────────────────────────
// Section gathers
// ─────────────────────────────────────────────────────────────
function fmtAge(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

async function loopHealth(ctx) {
  try {
    const items = await getLastPageItems(TABLES.event_log);
    const hb = items
      .filter((r) => (r.action || '').toLowerCase().includes('heartbeat'))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
    if (!hb) return 'unknown';
    const age = NOW_MS() - (hb.created_at || 0);
    if (age < 10 * 60000) return `fresh (${fmtAge(age)})`;
    if (age < 30 * 60000) return `stale (${fmtAge(age)})`;
    return `CRITICAL (${fmtAge(age)})`;
  } catch {
    return 'probe_err';
  }
}

async function queueState() {
  try {
    const items = await getLastPageItems(TABLES.scheduling_queue, 200);
    const dayAgo = NOW_MS() - DAY_MS;
    const pending = items.filter((r) => r.status === 'pending').length;
    const processing = items.filter((r) => r.status === 'processing').length;
    const completed24h = items.filter(
      (r) => r.status === 'completed' && (r.processed_at || r.created_at || 0) >= dayAgo,
    ).length;
    const failed24h = items.filter(
      (r) => r.status === 'failed' && (r.processed_at || r.created_at || 0) >= dayAgo,
    ).length;
    return { pending, processing, completed24h, failed24h };
  } catch {
    return null;
  }
}

async function broadcastState() {
  try {
    const items = await getLastPageItems(TABLES.broadcast_attempt, 100);
    const dayAgo = NOW_MS() - DAY_MS;
    const recent = items.filter((r) => (r.created_at || 0) >= dayAgo);
    return {
      fired: recent.length,
      claimed: recent.filter((r) => r.status === 'claimed').length,
      expired: recent.filter((r) => r.status === 'expired').length,
      open: recent.filter((r) => r.status === 'open').length,
    };
  } catch {
    return null;
  }
}

async function errorCount24h() {
  try {
    const items = await getLastPageItems(TABLES.event_log);
    const dayAgo = NOW_MS() - DAY_MS;
    return items.filter((r) => {
      const a = (r.action || '').toLowerCase();
      const recent = (r.created_at || 0) >= dayAgo;
      return (
        recent &&
        (a.includes('error') ||
          a.includes('fail') ||
          a.includes('fatal') ||
          a.endsWith('_blocked') ||
          a === 'scheduling_queue_orphan_job_skipped')
      );
    }).length;
  } catch {
    return -1;
  }
}

async function intake24h() {
  try {
    const items = await getLastPageItems(TABLES.event_log);
    const dayAgo = NOW_MS() - DAY_MS;
    const recent = items.filter((r) => (r.created_at || 0) >= dayAgo);
    const ahs = recent.filter((r) => r.action === 'ahs_dispatch_imported').length;
    const sp = recent.filter((r) => r.action === 'servicepower_dispatch_imported').length;
    const chat = recent.filter((r) => r.action === 'chat_job_created').length;
    const parallel = recent.filter((r) => r.action === 'parallel_job_created_from_email').length;
    return { ahs, sp, chat, parallel, total: ahs + sp + chat + parallel };
  } catch {
    return null;
  }
}

async function tier1Status() {
  // If any parallel_job_auto_enqueued events fired in last 7 days, scheduler-1 is live.
  try {
    const items = await getLastPageItems(TABLES.event_log);
    const weekAgo = NOW_MS() - 7 * DAY_MS;
    const hit = items.some(
      (r) => r.action === 'parallel_job_auto_enqueued' && (r.created_at || 0) >= weekAgo,
    );
    return hit ? 'ACTIVE' : 'PENDING (paste scheduler-1 to wake)';
  } catch {
    return 'unknown';
  }
}

// ─────────────────────────────────────────────────────────────
function todayLabel() {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date());
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────
export async function run(signal, ctx) {
  const { xano, log } = ctx;

  // Gather in parallel
  const [loop, queue, broadcasts, errors, intake, tier1] = await Promise.all([
    loopHealth(ctx),
    queueState(),
    broadcastState(),
    errorCount24h(),
    intake24h(),
    tier1Status(),
  ]);

  const lines = [`[ant] 7am status ${todayLabel()}`];
  lines.push(`loop ${loop}`);

  if (queue) {
    const queueParts = [`${queue.pending} pending`];
    if (queue.processing > 0) queueParts.push(`${queue.processing} processing`);
    queueParts.push(`${queue.completed24h} done/24h`);
    if (queue.failed24h > 0) queueParts.push(`${queue.failed24h} failed`);
    lines.push(`queue: ${queueParts.join(', ')}`);
  } else {
    lines.push('queue: probe_err');
  }

  if (broadcasts) {
    if (broadcasts.fired > 0 || broadcasts.open > 0) {
      const bParts = [`${broadcasts.fired} fired`];
      if (broadcasts.claimed > 0) bParts.push(`${broadcasts.claimed} claimed`);
      if (broadcasts.expired > 0) bParts.push(`${broadcasts.expired} expired`);
      if (broadcasts.open > 0) bParts.push(`${broadcasts.open} open`);
      lines.push(`broadcasts: ${bParts.join(', ')}`);
    }
  }

  lines.push(`errors: ${errors < 0 ? 'probe_err' : errors}/24h`);

  if (intake && intake.total > 0) {
    const iParts = [];
    if (intake.parallel > 0) iParts.push(`${intake.parallel} parallel`);
    if (intake.ahs > 0) iParts.push(`${intake.ahs} ahs`);
    if (intake.sp > 0) iParts.push(`${intake.sp} sp`);
    if (intake.chat > 0) iParts.push(`${intake.chat} chat`);
    lines.push(`intake: ${intake.total} jobs (${iParts.join(', ')})`);
  }

  lines.push(`Tier 1: ${tier1}`);

  const body = lines.join('\n');

  let smsRes = { success: false };
  try {
    smsRes = await toOwner(body, {
      action: 'operator_status_briefing_sent',
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    outcome: 'sent',
    loop_status: loop,
    queue_pending: queue ? queue.pending : -1,
    queue_completed_24h: queue ? queue.completed24h : -1,
    queue_failed_24h: queue ? queue.failed24h : -1,
    broadcasts_fired: broadcasts ? broadcasts.fired : -1,
    broadcasts_claimed: broadcasts ? broadcasts.claimed : -1,
    errors_24h: errors,
    intake_24h: intake ? intake.total : -1,
    tier1_status: tier1,
    sms: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };

  await xano.markSignalProcessed(signal.id, 'operator_status_briefing_handled', meta);
  log('operator_status_briefing_handled', meta);

  return { success: true, action: 'sent', ...meta };
}
