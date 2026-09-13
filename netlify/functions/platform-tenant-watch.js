// platform-tenant-watch — the thing that tells a human the CLONING system broke.
//
// WHY THIS EXISTS: 26 platform crons run today and not one of them watches the thing the
// whole SaaS rests on — standing up a new shop. platform-migration-watch covers the TN
// Xano<->Supabase migration only. Nothing has ever watched tenants. Audited 2026-09-13 and
// found, by hand, two live tenants both named "Queen Anne's" with 14 logins between them,
// plus a throwaway shop nobody had cleaned up. All of it invisible.
//
// The failure this class produces is quiet and expensive: a signup takes a card, half-builds,
// and leaves a live billable tenant nobody can log into. That exact bug shipped on 2026-09-12
// (owner insert failed AFTER the company was created -> status active, plan office, 0 seats)
// and the fix note says plainly: "A seatless company is the tell. Query it periodically."
// Periodically-by-hand is not a check. This is the check.
//
// Same discipline as platform-migration-watch: watch the DATA, never a function's self-report.
//   • seatless      — a company with ZERO logins (billable, nobody can get in)
//   • ownerless     — has seats but no owner role (nobody can reach owner.html)
//   • dup_name      — two shops share a name (a duplicate signup forked silently)
//   • half_built    — owner-only pack older than a couple of hours (provision died partway)
//   • techless      — a day-old shop with no active technician (cannot dispatch)
//   • no_jobs       — REPORTED, never paged: a week-old shop that never got data in
//                     (the import wizard never ran). Hygiene, not a breakage.
//
// ⚠️ The alert tag must be allowlisted in _lib/office-gate SHIP_TAGS or it is written and
// delivered NOWHERE (Teddy's 2026-08-28 office-SMS kill rule). It is: 'tenant_health'.
//
//   GET ?secret=<admin>[&dry=1]    dry=1 never texts
const sms = require('./_lib/sms');
const { getSecretPreferVault } = require('./_lib/secrets');

const TN = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const SB = 'https://tntbhfwitytkcoqlejwc.supabase.co';
const TAG = 'tenant_health';

// Thresholds set well past normal so a healthy board never pages. Calibrated 2026-09-13
// against the live set: every tenant had >=1 owner and >=1 active tech, so none of these
// fire on a clean platform.
const HALF_BUILT_H  = 2;    // a pack builds in ~5s; 2h means it died
const TECHLESS_H    = 24;   // give a new shop a day to add its crew
const NO_JOBS_DAYS  = 7;    // report-only
const RENAG_HOURS   = 12;   // slower than migration-watch — this is hygiene, not an outage

const json = (s, b) => ({ statusCode: s, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const key = () => process.env.PLATFORM_SUPABASE_SERVICE_KEY || '';
const H = () => { const k = key(); return { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' }; };

async function q(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H(), signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`sb ${r.status} ${path.slice(0, 60)}`);
  return r.json();
}
const hoursAgo = (iso) => (!iso ? Infinity : (Date.now() - Date.parse(iso)) / 3600000);

// Watch state is STATE, not a log — ONE row, updated in place. The first cut of
// migration-watch inserted a fresh row every tick (96/day, unbounded, no prune) which is
// the same shape as the backup table that grew to 978 MB. A monitor must not be a leak.
let _stateId = null;
async function readState() {
  try {
    const rows = await q(`event?company_id=eq.${TN}&type=eq.tenant_watch&select=id,payload&order=id.desc&limit=1`);
    const r = (rows && rows[0]) || null;
    _stateId = r ? r.id : null;
    return (r && r.payload) || {};
  } catch (_) { _stateId = null; return {}; }
}
async function writeState(payload) {
  try {
    const body = JSON.stringify({ company_id: TN, type: 'tenant_watch', entity: 'platform', payload });
    if (_stateId) {
      const r = await fetch(`${SB}/rest/v1/event?id=eq.${_stateId}`, {
        method: 'PATCH', headers: { ...H(), Prefer: 'return=minimal' }, body, signal: AbortSignal.timeout(12000),
      });
      if (r.ok) return;
      _stateId = null;
    }
    await fetch(`${SB}/rest/v1/event`, {
      method: 'POST', headers: { ...H(), Prefer: 'return=minimal' }, body, signal: AbortSignal.timeout(12000),
    });
  } catch (_) {}
}

async function runChecks() {
  const fails = [];
  const stats = {};
  const detail = { seatless: [], ownerless: [], dup_name: [], half_built: [], techless: [], no_jobs: [] };

  // THREE reads for the whole platform, then everything is computed in memory. Tenant counts
  // are small; a per-company round trip would be 6 requests per shop for no gain.
  const companies = await q('company?select=id,slug,name,status,plan,created_at&order=created_at.asc');
  const users = await q('app_user?select=company_id,role');
  const techs = await q('technician?select=company_id,active');

  const seatsBy = {}; const ownersBy = {}; const techBy = {};
  (users || []).forEach((u) => {
    seatsBy[u.company_id] = (seatsBy[u.company_id] || 0) + 1;
    if (String(u.role) === 'owner') ownersBy[u.company_id] = (ownersBy[u.company_id] || 0) + 1;
  });
  (techs || []).forEach((t) => { if (t.active !== false) techBy[t.company_id] = (techBy[t.company_id] || 0) + 1; });

  // Exact job counts without hauling rows (PostgREST caps a fetch-all at ~1,000, which is
  // how a fully-migrated shop once read as "jobs: 0").
  const jobCount = async (id) => {
    try {
      const r = await fetch(`${SB}/rest/v1/job?company_id=eq.${id}&select=id`,
        { method: 'HEAD', headers: { ...H(), Prefer: 'count=exact', Range: '0-0' }, signal: AbortSignal.timeout(12000) });
      const n = Number(String(r.headers.get('content-range') || '').split('/')[1]);
      return Number.isFinite(n) ? n : 0;
    } catch (_) { return -1; }   // -1 = unknown, never counted as "no jobs"
  };

  const nameCount = {};
  (companies || []).forEach((c) => {
    const k = String(c.name || '').trim().toLowerCase();
    if (k) nameCount[k] = (nameCount[k] || 0) + 1;
  });

  stats.tenants = (companies || []).length;
  for (const c of (companies || [])) {
    const live = String(c.status || 'active') !== 'churned';
    if (!live) continue;
    const seats = seatsBy[c.id] || 0;
    const owners = ownersBy[c.id] || 0;
    const crew = techBy[c.id] || 0;
    const age = hoursAgo(c.created_at);

    // A seatless company is THE tell for a provision that took money and died. It is
    // billable, it is active, and nobody on earth can sign into it.
    if (seats === 0) detail.seatless.push(c.slug);
    else if (owners === 0) detail.ownerless.push(c.slug);
    else if (seats < 2 && age > HALF_BUILT_H) detail.half_built.push(c.slug);

    if (crew === 0 && age > TECHLESS_H) detail.techless.push(c.slug);
    if ((nameCount[String(c.name || '').trim().toLowerCase()] || 0) > 1) detail.dup_name.push(c.slug);

    if (age > NO_JOBS_DAYS * 24) {
      const n = await jobCount(c.id);
      if (n === 0) detail.no_jobs.push(c.slug);
    }
  }

  if (detail.seatless.length)  fails.push(`${detail.seatless.length} tenant(s) with NO logins — billable and nobody can get in: ${detail.seatless.join(', ')}`);
  if (detail.ownerless.length) fails.push(`${detail.ownerless.length} tenant(s) with no owner seat: ${detail.ownerless.join(', ')}`);
  if (detail.half_built.length) fails.push(`${detail.half_built.length} half-built shop(s) — owner only, provision died partway: ${detail.half_built.join(', ')}`);
  if (detail.dup_name.length)  fails.push(`duplicate shop name across ${detail.dup_name.length} tenants: ${detail.dup_name.join(', ')}`);
  if (detail.techless.length)  fails.push(`${detail.techless.length} shop(s) with no active tech after a day: ${detail.techless.join(', ')}`);
  // no_jobs is deliberately NOT a fail — a trial that hasn't imported yet isn't broken.

  Object.keys(detail).forEach((k) => { stats[k] = detail[k].length; });
  return { fails, stats, detail };
}

exports.run = async function run(opts) {
  const o = opts || {};
  if (!key()) return { ok: false, error: 'platform service key not configured' };
  const enabled = String((await getSecretPreferVault('PLATFORM_TENANT_WATCH')) || 'true').toLowerCase() !== 'false';
  if (!enabled && !o.dry) return { ok: true, disabled: true };

  const { fails, stats, detail } = await runChecks();
  const healthy = fails.length === 0;
  const prev = await readState();
  const wasDown = !!prev.down;
  const lastAlert = Number(prev.last_alert_ms || 0);
  const renag = Date.now() - lastAlert > RENAG_HOURS * 3600000;

  let texted = null;
  if (!o.dry) {
    if (!healthy && (!wasDown || renag)) {
      const body = `🔴 Ant tenants: ${fails.join(' · ')}`.slice(0, 300);
      try { await sms.sendSms(await ownerCell(), body, 'owner', TAG); texted = 'alert'; } catch (_) { texted = 'send_failed'; }
      await writeState({ down: true, fails, stats, last_alert_ms: Date.now(), at: new Date().toISOString() });
    } else if (healthy && wasDown) {
      try { await sms.sendSms(await ownerCell(), '🟢 Ant tenants: back to normal — every shop has a login, an owner and a crew.', 'owner', TAG); texted = 'recovery'; } catch (_) { texted = 'send_failed'; }
      await writeState({ down: false, fails: [], stats, at: new Date().toISOString() });
    } else {
      await writeState({ down: !healthy, fails, stats, last_alert_ms: lastAlert || 0, at: new Date().toISOString() });
    }
  }
  return { ok: true, healthy, fails, stats, detail, texted, dry: !!o.dry };
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
    return json(200, await exports.run({ dry: p.dry === '1' }));
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
