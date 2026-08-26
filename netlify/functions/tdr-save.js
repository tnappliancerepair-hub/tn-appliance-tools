// tdr-save — Phase 0 Part A: the durable TDR/part-number save path.
//
// THE PROBLEM it fixes: tech-job.html saved the TDR by POSTing straight to Xano
// create_tdr. When Xano is compute-saturated that write hangs ("won't save the
// part number") and the tech's work is stuck spinning or lost.
//
// THE FIX: a save lands in fast/healthy Supabase FIRST (tdr_pending, ~50ms), so it
// is DURABLE the instant it returns — no matter what Xano is doing. Then, in the
// same call, we relay to Xano best-effort with a hard time-box. If Xano answers we
// mark the row synced and hand back the real {tdr}. If Xano is slow/down we leave
// the row pending and tdr-sync-cron drains it later — the tech is never told it
// failed, because it didn't.
//
// SAFE + REVERSIBLE: gated by the Netlify env flag TDR_DURABLE_SAVE. Read from
// process.env DIRECTLY (never getSecret), because the whole point is Xano-
// independence — a flag read must not itself depend on the flapping Xano vault.
//   - flag !== 'true'  -> pure passthrough to Xano (today's exact behavior)
//   - Supabase down     -> pure passthrough to Xano (never worse than today)
// So worst case is "back to today," never worse. Flip the flag off = instant
// rollback to direct Xano.
'use strict';

const crypto = require('crypto');
const sb = require('./_lib/supabase');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

// Best-effort Xano relay when we already have a durable copy (short — the cron
// catches anything that misses). Authoritative when we do NOT (flag off / Supabase
// down) — longer, because this call IS the save.
const RELAY_MS = 6000;
const AUTHORITATIVE_MS = 14000;

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

const flagOn = () => String(process.env.TDR_DURABLE_SAVE || '').trim().toLowerCase() === 'true';

// Content signature -> identical re-tap = same client_key = same tdr_pending row
// (no duplicate). Only the fields that define "what the tech saved" go into it.
function clientKeyFor(b) {
  const sig = [
    b.job_id, b.technician_id,
    b.technician_notes, b.diagnosis, b.failed_component,
    b.repair_completed, b.verified_part_number, b.labor_time_hours,
  ].map((v) => (v == null ? '' : String(v))).join('|');
  return crypto.createHash('sha1').update(sig).digest('hex');
}

// Relay the exact create_tdr body to Xano. Returns { tdr } on success or throws.
async function relayToXano(body, ms) {
  const r = await fetch(`${XANO}/create_tdr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`create_tdr -> ${r.status}`);
  return r.json();
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ ok: false, error: 'method' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { body = null; }
  if (!body || body.job_id == null) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'bad_body' }) };
  }

  // ---- PASSTHROUGH (flag off) — today's exact behavior, Xano is authoritative ----
  if (!flagOn()) {
    try {
      const d = await relayToXano(body, AUTHORITATIVE_MS);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, durable: false, xano_synced: !!(d && d.tdr), tdr: d && d.tdr ? d.tdr : null }) };
    } catch (e) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, durable: false, xano_synced: false, error: String(e.message || e) }) };
    }
  }

  // ---- DURABLE PATH (flag on) ----
  const clientKey = clientKeyFor(body);
  let durable = false;

  // 1) Land it in Supabase FIRST. This is what makes the save un-loseable.
  try {
    if (await sb.isConnected()) {
      try {
        await sb.insert('tdr_pending', {
          job_id: body.job_id != null ? Number(body.job_id) : null,
          technician_id: body.technician_id != null ? Number(body.technician_id) : null,
          client_key: clientKey,
          payload: body,
          synced: false,
          attempts: 0,
          source: 'tech_app',
        });
        durable = true;
      } catch (e) {
        // Unique-violation on client_key = the exact same save is already durable
        // (idempotent re-tap). Any other error = not durable -> fall through to an
        // authoritative Xano write so the save is never silently dropped.
        const msg = String(e.message || e);
        if (/409|duplicate|unique/i.test(msg)) durable = true;
        else console.error('[tdr-save] durable insert failed: ' + msg);
      }
    }
  } catch (_) { /* isConnected threw -> durable stays false */ }

  // Supabase unavailable -> behave like passthrough (authoritative Xano write).
  if (!durable) {
    try {
      const d = await relayToXano(body, AUTHORITATIVE_MS);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, durable: false, xano_synced: !!(d && d.tdr), tdr: d && d.tdr ? d.tdr : null }) };
    } catch (e) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, durable: false, xano_synced: false, error: String(e.message || e) }) };
    }
  }

  // 2) Durable copy is safe. Now relay to Xano best-effort, time-boxed. Whatever
  //    happens here, the tech gets a successful, durable save.
  let xanoTdr = null;
  try {
    const d = await relayToXano(body, RELAY_MS);
    if (d && d.tdr) {
      xanoTdr = d.tdr;
      // mark the pending row synced (best-effort; the cron would catch it anyway)
      try {
        await sb.update('tdr_pending', { client_key: 'eq.' + clientKey }, {
          synced: true, synced_at: new Date().toISOString(), attempts: 1,
        });
      } catch (_) {}
    }
  } catch (_) { /* leave it pending; tdr-sync-cron drains it */ }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok: true,
      durable: true,
      xano_synced: !!xanoTdr,
      // Give the client a real tdr when Xano answered; otherwise a durable
      // placeholder so the UI treats the save as done (it IS done).
      tdr: xanoTdr || { id: 'pending', pending: true, client_key: clientKey },
    }),
  };
};
