// address-confirm-check — finds jobs where the customer has TWO addresses (the job's
// service address ≠ our canonical customer record) and texts the customer to confirm
// which house, before the tech ever rolls (Teddy 2026-07-17). Conflict-only + one text
// per job + guardedSend, so volume is tiny and safe.
//
//   GET/POST ?job_id=N[&dry=1]                 -> check one job (dry=1 previews, sends nothing)
//   GET/POST ?sweep=1&secret=<admin>[&dry=1]   -> scan recent active jobs for conflicts
//   (scheduled cron)                            -> same sweep, self-authorized
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const { checkAndConfirm, LIVE } = require('./_lib/address-notify');

const ADMIN = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
// Only look at jobs in an active, pre-visit state — never dredge the whole back-catalog.
const ACTIVE_STATUSES = ['scheduled', 'not_ready', 'needs_scheduled', 'awaiting_parts'];
const RECENT_MS = 12 * 24 * 60 * 60 * 1000;   // only jobs created in the last ~12 days
const DEEP_CHECK_CAP = 80;                     // customer read budget per run
const SEND_CAP = 8;                            // gentle ramp — dedup prevents repeats anyway

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function hasStreet(s) { const t = String(s || '').trim(); return /[a-zA-Z]/.test(t) && /\d/.test(t) && t.replace(/\s/g, '').length >= 4 && !/^\s*1\s*[, ]/.test(t); }

exports.handler = async function (event) {
  const p = Object.assign({}, event.queryStringParameters || {});
  let isScheduled = false;
  try { const bj = JSON.parse(event.body || '{}'); if (bj && bj.next_run) isScheduled = true; } catch (_) {}
  const dry = String(p.dry || '') === '1';

  // ── single job (manual / testing) ──
  if (p.job_id) {
    const r = await checkAndConfirm({ job_id: Number(p.job_id), dry });
    return json(200, { ok: true, live: LIVE, result: r });
  }

  // ── sweep (cron self-authorizes; manual needs the admin secret) ──
  if (!isScheduled && !(p.sweep === '1' && p.secret === ADMIN)) {
    return json(200, { ok: false, error: 'pass ?job_id=N, or ?sweep=1&secret=… (cron runs automatically)' });
  }

  const now = Date.now();
  const seen = new Set();
  const candidates = [];
  for (const st of ACTIVE_STATUSES) {
    let rows = [];
    try { rows = (await crud.searchPage(crud.TABLES.jobs, { scheduling_status: st }, { id: 'desc' }, 200)) || []; } catch (_) {}
    for (const j of rows) {
      if (seen.has(j.id)) continue; seen.add(j.id);
      const created = Number(j.created_at || 0);
      if (created && (now - created) > RECENT_MS) continue;      // stay in the recent window
      if (!hasStreet(j.service_address)) continue;               // needs a real service street to conflict
      candidates.push(j.id);
      if (candidates.length >= DEEP_CHECK_CAP) break;
    }
    if (candidates.length >= DEEP_CHECK_CAP) break;
  }

  const results = [];
  let sent = 0;
  for (const jid of candidates) {
    const r = await checkAndConfirm({ job_id: jid, dry });
    if (r.reason === 'no_conflict' || r.reason === 'already_sent') continue;   // quiet — the common case
    results.push(r);
    if (r.ok) { sent++; if (!dry && sent >= SEND_CAP) break; }
  }

  return json(200, { ok: true, live: LIVE, dry, scanned: candidates.length, sent, results });
};
