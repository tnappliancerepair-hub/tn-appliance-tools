'use strict';
// loop-control.js — phone↔loop control channel, Xano-INDEPENDENT.
//
// Backed by Supabase (via _lib/supabase.js) so it keeps working even when
// Xano is melting — which is exactly when you'd want to pause the loop.
// Reuses the existing Supabase `event_log` table (no new infra):
//   action='loop_control'  → the pause flag the loop reads each tick
//   action='loop_status'   → the loop's heartbeat the phone page displays
//
// Actions (query param ?action=):
//   status              (open)  → { paused, paused_since, loop:{...}, loop_seen_at }
//   pause   &key=SECRET         → set paused=true
//   resume  &key=SECRET         → set paused=false
//   heartbeat &key=SECRET (POST)→ loop posts its status here
//
// SECRET: env LOOP_CONTROL_SECRET, else the fallback below. Set it in Netlify
// env to rotate. The phone page (loop-control.html) carries the same secret.

const supa = require('./_lib/supabase');

const SECRET = process.env.LOOP_CONTROL_SECRET || 'tn-loop-ctl-7b2f9';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

async function latest(action) {
  try {
    const rows = await supa.select('event_log', {
      action: 'eq.' + action,
      order: 'created_at.desc',
      limit: '1',
    });
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (_) {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  const q = event.queryStringParameters || {};
  const action = String(q.action || 'status').toLowerCase();

  // ── STATUS (open, no auth — just reads the flag + the loop's heartbeat) ──
  if (action === 'status') {
    const [ctl, hb] = await Promise.all([latest('loop_control'), latest('loop_status')]);
    const md = (ctl && ctl.metadata) || {};
    const hbAgeMin = hb && hb.created_at
      ? Math.round((Date.now() - new Date(hb.created_at).getTime()) / 60000)
      : null;
    return json(200, {
      ok: true,
      paused: !!md.paused,
      paused_since: ctl ? ctl.created_at : null,
      paused_by: md.by || null,
      loop: (hb && hb.metadata) || null,
      loop_seen_at: hb ? hb.created_at : null,
      loop_seen_min_ago: hbAgeMin,
      // The loop heartbeats every tick (~2 min). If we haven't heard from it in
      // a while, it's likely stopped — surface that so the phone page can warn.
      loop_alive: hbAgeMin != null && hbAgeMin <= 6,
    });
  }

  // ── HEARTBEAT (the loop posts here each tick) ──
  if (action === 'heartbeat') {
    if (String(q.key || '') !== SECRET) return json(401, { ok: false, error: 'unauthorized' });
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}
    await supa.recordEvent({ action: 'loop_status', metadata: body, source: 'loop' }).catch(() => {});
    return json(200, { ok: true });
  }

  // ── PAUSE / RESUME (require secret) ──
  if (action === 'pause' || action === 'resume') {
    if (String(q.key || '') !== SECRET) return json(401, { ok: false, error: 'unauthorized' });
    const paused = action === 'pause';
    try {
      await supa.recordEvent(
        { action: 'loop_control', metadata: { paused, by: q.by || 'phone', at: Date.now() }, source: 'phone' },
        { throwOnError: true }
      );
    } catch (e) {
      return json(502, { ok: false, error: 'store_unavailable', detail: String(e.message || e) });
    }
    return json(200, { ok: true, paused });
  }

  return json(400, { ok: false, error: 'unknown action' });
};
