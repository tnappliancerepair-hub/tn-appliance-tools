// platform-migration-watch — the thing that tells a human the migration broke.
//
// WHY THIS EXISTS: nine crons now carry TN between Xano and Supabase (mirror, three
// write-backs, two tees, parts, reconcile, job-back) and NOTHING watched any of them.
// On 2026-09-10 the mirror wrote nothing for 45 minutes and every run still reported
// healthy; the same day a tee quietly wrote 2,400 junk rows/day for four days. Both were
// found by hand. The standing lesson from that day is the whole design here:
//
//     "the run returned ok" is not evidence the write landed —
//     check the row count you actually wrote.
//
// So this watches the DATA, never a function's own self-report:
//   • mirror_stale        — no job row touched in N minutes (mirror runs every 5)
//   • booking_stuck       — a platform booking sat unconsumed in the queue too long
//   • thread_flood        — a writer is looping (generalizes the waiver-note bug)
//   • parity_gap          — real jobs in Xano that never reached the platform
//   • status_drift        — the platform is ahead of Xano and the pusher isn't closing it
//
// Alerts are deduped, re-nag on a slow cadence, and send ONE recovery text when a
// previously-failing check goes green — same shape as deploy-watch.
//
// ⚠️ The alert tag must be allowlisted in _lib/office-gate SHIP_TAGS or it is written
// and delivered NOWHERE (Teddy's 2026-08-28 office-SMS kill rule). It is: 'migration_down'.
//
//   GET ?secret=<admin>[&dry=1][&full=1]   dry=1 never texts; full=1 forces the parity walk
const sms = require('./_lib/sms');
const { getSecretPreferVault } = require('./_lib/secrets');

const TN = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const SB = 'https://tntbhfwitytkcoqlejwc.supabase.co';
const TAG = 'migration_down';

// Thresholds. Each is set well past normal so a green board never pages anybody:
// the mirror runs every 5 min, the booking pusher every 5, and TN's real thread traffic
// is a handful of rows an hour.
const STALE_MIN     = 20;   // 4 missed mirror ticks
const BOOKING_MIN   = 25;   // 5 missed pusher ticks
const FLOOD_PER_HR  = 200;  // a looping writer, not a busy day
const PARITY_MAX    = 5;    // honest baseline on 2026-09-10 was 1
const DRIFT_MAX     = 10;   // baseline 1
const RENAG_HOURS   = 6;
const PARITY_MS     = 20000; // hard ceiling on the Xano walk
const BACKUP_MAX_H  = 30;   // nightly 8am CT run; alert if the newest one is older

const json = (s, b) => ({ statusCode: s, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const key = () => process.env.PLATFORM_SUPABASE_SERVICE_KEY || '';
const H = () => { const k = key(); return { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' }; };

async function q(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H(), signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`sb ${r.status} ${path.slice(0, 60)}`);
  return r.json();
}
// Exact count without hauling rows back.
async function count(path) {
  const r = await fetch(`${SB}/rest/v1/${path}${path.includes('?') ? '&' : '?'}select=id`,
    { headers: { ...H(), Prefer: 'count=exact', Range: '0-0' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`sb ${r.status}`);
  const n = Number(String(r.headers.get('content-range') || '').split('/')[1]);
  return Number.isFinite(n) ? n : 0;
}
const minsAgo = (iso) => (!iso ? Infinity : Math.round((Date.now() - Date.parse(iso)) / 60000));

// ── watch state lives on the platform, not in Xano — a monitor for the migration off
// Xano must not itself die when Xano does. ──
// Watch state is STATE, not a log -- ONE row, updated in place. The first cut
// inserted a fresh row every tick: 96 rows/day, unbounded, no prune. That is the
// same shape as the backup table that quietly grew to 978 MB and became the #1
// autovacuum-churn source. A monitor must not be a leak.
let _stateId = null;
async function readState() {
  try {
    const rows = await q(`event?company_id=eq.${TN}&type=eq.migration_watch&select=id,payload&order=id.desc&limit=1`);
    const r = (rows && rows[0]) || null;
    _stateId = r ? r.id : null;
    return (r && r.payload) || {};
  } catch (_) { _stateId = null; return {}; }
}
async function writeState(payload) {
  try {
    const body = JSON.stringify({ company_id: TN, type: 'migration_watch', entity: 'platform', payload });
    if (_stateId) {
      const r = await fetch(`${SB}/rest/v1/event?id=eq.${_stateId}`, {
        method: 'PATCH', headers: { ...H(), Prefer: 'return=minimal' },
        body, signal: AbortSignal.timeout(12000),
      });
      if (r.ok) return;            // updated in place
      _stateId = null;             // row vanished -> fall through and re-create
    }
    await fetch(`${SB}/rest/v1/event`, {
      method: 'POST', headers: { ...H(), Prefer: 'return=minimal' },
      body, signal: AbortSignal.timeout(12000),
    });
  } catch (_) {}
}

async function runChecks(opts) {
  const o = opts || {};
  const fails = [];
  const stats = {};

  // 1. MIRROR FRESHNESS — the single most load-bearing number. If this stalls the whole
  //    platform is quietly serving yesterday's board.
  try {
    const rows = await q(`job?company_id=eq.${TN}&select=updated_at&order=updated_at.desc&limit=1`);
    const age = minsAgo(rows && rows[0] && rows[0].updated_at);
    stats.mirror_age_min = age === Infinity ? null : age;
    if (age > STALE_MIN) fails.push(`mirror stalled — no job written in ${age}m`);
  } catch (e) { fails.push(`mirror check failed — ${String(e.message).slice(0, 60)}`); }

  // 2. BOOKING QUEUE — platform_booked_at is a CONSUMABLE queue; the pusher clears it.
  //    A row still sitting there means the office booked a job Xano never heard about.
  try {
    const cut = new Date(Date.now() - BOOKING_MIN * 60000).toISOString();
    const n = await count(`job?company_id=eq.${TN}&platform_booked_at=not.is.null&platform_booked_at=lt.${cut}`);
    stats.booking_stuck = n;
    if (n > 0) fails.push(`${n} platform booking(s) not pushed to Xano in ${BOOKING_MIN}m`);
  } catch (e) { fails.push(`booking check failed — ${String(e.message).slice(0, 60)}`); }

  // 3. THREAD FLOOD — generalizes the 2026-09-10 waiver-note bug: a tee re-reading its
  //    window and re-inserting the same row every tick. Catches the whole class, not one case.
  try {
    const cut = new Date(Date.now() - 3600000).toISOString();
    const n = await count(`thread_message?company_id=eq.${TN}&created_at=gte.${cut}`);
    stats.thread_last_hour = n;
    if (n > FLOOD_PER_HR) fails.push(`thread flood — ${n} messages written in the last hour (a writer is looping)`);
  } catch (e) { /* non-fatal: never page on the canary itself */ }

  // 4. PARITY — a full Xano walk (7 statuses x pages). Expensive, so hourly unless forced,
  //    and hard-bounded: on a slow Xano this exceeds the 26s edge limit for a MANUAL call
  //    while the scheduled run (15-min allowance) still completes. A check that can silently
  //    never run is worse than no check, so a skip is REPORTED in stats rather than vanishing.
  // 4b) OFF-SITE BACKUP — read the MANIFEST, never the function's exit code.
  // On 2026-09-10 the nightly Xano->ops backup had been running (and retrying
  // itself 3x) for a week while silently dropping 25 of 29 tables, and the ONLY
  // symptom was a manifest row that never got written. So: check the manifest.
  // BOTH sources: Xano->ops (_manifest) and platform->ops (_manifest_platform).
  // A backup nobody watches is how 25 tables went missing for a week.
  try {
    const sbops = require('./_lib/supabase');
    stats.backup = {};
    for (const [label, mname] of [['xano', '_manifest'], ['platform', '_manifest_platform']]) {
      const rows = await sbops.select('xano_backup_chunks', {
        table_name: 'eq.' + mname, order: 'created_at.desc', limit: '1',
        select: 'snapshot_date,created_at,rows',
      });
      const m = (rows && rows[0]) || null;
      if (!m) {
        stats.backup[label] = 'never';
        fails.push(`${label} off-site backup has never written a manifest`);
        continue;
      }
      const ageH = Math.round((Date.now() - Date.parse(m.created_at)) / 3600000);
      const body = m.rows || {};
      stats.backup[label] = { date: m.snapshot_date, age_h: ageH, tables: (body.tables || []).length, rows: body.total_rows, complete: body.complete !== false };
      if (ageH > BACKUP_MAX_H) fails.push(`${label} off-site backup is ${ageH}h old (last good ${m.snapshot_date})`);
      else if (body.complete === false) {
        // `complete:false` means budget/truncation/error only. The weekly-cadence
        // skip (parts_orders on a non-Sunday) is BY DESIGN and never flips it.
        const sk = (body.skipped_budget || []).length;
        const tr = (body.tables || []).filter((t) => t && (t.truncated || t.error)).length;
        fails.push(`${label} off-site backup did not finish — ${sk} skipped, ${tr} truncated/errored`);
      }
    }
  } catch (e) { stats.backup = 'check_failed:' + String((e && e.message) || e).slice(0, 40); }

  const ct = new Date(Date.now() - 5 * 3600000).getUTCMinutes();
  if (o.full || ct < 15) {
    try {
      const parity = require('./platform-tn-parity');
      const p = await Promise.race([
        parity.runParity({}),
        new Promise((_, rej) => setTimeout(() => rej(new Error('parity_timeout')), PARITY_MS)),
      ]);
      stats.missing_from_platform = p.missing_from_platform;
      stats.status_drift = p.status_drift;
      stats.platform_only_open = p.platform_only_open;
      if (p.missing_from_platform > PARITY_MAX) fails.push(`${p.missing_from_platform} real Xano jobs missing from the platform`);
      if (p.status_drift > DRIFT_MAX) fails.push(`${p.status_drift} jobs where the platform is ahead of Xano`);
    } catch (e) {
      // Xano being slow is not a migration failure — do not page on it. But say so out loud.
      stats.parity_skipped = String((e && e.message) || e).slice(0, 40);
    }
  } else stats.parity_skipped = 'not_this_tick';

  return { fails, stats };
}

exports.run = async function run(opts) {
  const o = opts || {};
  if (!key()) return { ok: false, error: 'platform service key not configured' };
  const enabled = String((await getSecretPreferVault('PLATFORM_MIGRATION_WATCH')) || 'true').toLowerCase() !== 'false';
  if (!enabled && !o.dry) return { ok: true, disabled: true };

  const { fails, stats } = await runChecks(o);
  const healthy = fails.length === 0;
  const prev = await readState();
  const wasDown = !!prev.down;
  const lastAlert = Number(prev.last_alert_ms || 0);
  const renag = Date.now() - lastAlert > RENAG_HOURS * 3600000;

  let texted = null;
  if (!o.dry) {
    if (!healthy && (!wasDown || renag)) {
      const body = `🔴 Ant migration: ${fails.join(' · ')}`.slice(0, 300);
      try { await sms.sendSms(await ownerCell(), body, 'owner', TAG); texted = 'alert'; } catch (_) { texted = 'send_failed'; }
      await writeState({ down: true, fails, stats, last_alert_ms: Date.now(), at: new Date().toISOString() });
    } else if (healthy && wasDown) {
      try { await sms.sendSms(await ownerCell(), '🟢 Ant migration: back to normal — mirror, bookings and parity all green.', 'owner', TAG); texted = 'recovery'; } catch (_) { texted = 'send_failed'; }
      await writeState({ down: false, fails: [], stats, at: new Date().toISOString() });
    } else {
      await writeState({ down: !healthy, fails, stats, last_alert_ms: lastAlert || 0, at: new Date().toISOString() });
    }
  }
  return { ok: true, healthy, fails, stats, texted, dry: !!o.dry };
};

async function ownerCell() {
  return (await getSecretPreferVault('OWNER_CELL')) || process.env.OWNER_PHONE || '+16154855795';
}

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  const admin = (await getSecretPreferVault('VAPI_ADMIN_SECRET')) || process.env.VAPI_ADMIN_SECRET || '';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && admin && p.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  try {
    return json(200, await exports.run({ dry: p.dry === '1', full: p.full === '1' }));
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
