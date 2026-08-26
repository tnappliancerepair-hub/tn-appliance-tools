// tdr-sync-cron — Phase 0 Part A: drains the durable TDR queue into Xano.
//
// tdr-save lands every save in Supabase tdr_pending (durable, instant) and relays
// to Xano best-effort. Anything that missed the relay (Xano was slow/down) sits in
// tdr_pending with synced=false. This cron runs every minute, replays those rows
// into Xano create_tdr, and marks them synced — so even a long Xano outage loses
// NOTHING; every part number lands the moment Xano recovers.
//
// Scheduled (see netlify.toml). Netlify scheduled functions edge-403 on manual
// HTTP, so this is a pure cron; there is no secret-gated twin needed (the work is
// idempotent + self-contained). Best-effort throughout: an error on one row must
// never stop the drain, and the function always returns 200 so Netlify doesn't
// retry-storm.
'use strict';

const sb = require('./_lib/supabase');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const BATCH = 25;          // rows per run — small, so a backlog drains steadily without hammering Xano
const MAX_ATTEMPTS = 6;    // after this many failures, stop retrying (park it, alert-worthy)
const RELAY_MS = 8000;

async function relayToXano(body) {
  const r = await fetch(`${XANO}/create_tdr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(RELAY_MS),
  });
  if (!r.ok) throw new Error(`create_tdr -> ${r.status}`);
  return r.json();
}

exports.handler = async function () {
  const out = { ok: true, drained: 0, synced: 0, failed: 0, parked: 0 };

  try {
    if (!(await sb.isConnected())) return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'supabase_not_configured' }) };

    // Oldest unsynced rows still within the retry budget.
    const rows = await sb.select('tdr_pending', {
      select: 'id,client_key,payload,attempts',
      synced: 'is.false',
      attempts: `lt.${MAX_ATTEMPTS}`,
      order: 'created_at.asc',
      limit: String(BATCH),
    });
    if (!Array.isArray(rows) || rows.length === 0) return { statusCode: 200, body: JSON.stringify({ ok: true, drained: 0 }) };

    for (const row of rows) {
      out.drained++;
      try {
        const d = await relayToXano(row.payload);
        if (d && d.tdr) {
          out.synced++;
          try {
            await sb.update('tdr_pending', { id: 'eq.' + row.id }, {
              synced: true, synced_at: new Date().toISOString(), attempts: (row.attempts || 0) + 1, last_error: null,
            });
          } catch (_) {}
        } else {
          throw new Error('no_tdr_in_response');
        }
      } catch (e) {
        out.failed++;
        const attempts = (row.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) out.parked++;
        try {
          await sb.update('tdr_pending', { id: 'eq.' + row.id }, {
            attempts, last_error: String(e.message || e).slice(0, 300),
          });
        } catch (_) {}
      }
    }
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e), ...out }) };
  }

  return { statusCode: 200, body: JSON.stringify(out) };
};
