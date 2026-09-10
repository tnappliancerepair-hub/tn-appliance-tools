// platform-tn-booking-back — carry a booking made ON THE PLATFORM back into Xano.
//
// THE LAST ONE-WAY GAP. platform-tn-mirror moves jobs Xano -> platform every 5 minutes, and its
// never-walk-backwards guard now stops Xano ERASING a booking the office made here. But nothing
// carried the booking the other way, so while both systems are live the legacy office board and
// the Xano tech app were blind to work booked on the platform. The office had to keep booking in
// Xano, which is the one thing that stops the crew moving over.
//
// HOW IT KNOWS WHAT TO PUSH — an explicit stamp, never inference.
// The three booking surfaces write straight to PostgREST from the browser, so there is no server
// hook to fire on. Inferring "the platform has a day, Xano is blank => the platform booked it"
// is WRONG in a real case: Xano UNSCHEDULING a job looks byte-for-byte identical, and pushing
// back would resurrect a booking someone deliberately cleared. So each booking surface stamps
// job.platform_booked_at, and this pusher stamps platform_booked_pushed_at once Xano accepts.
// A reschedule bumps booked_at past pushed_at and the job simply re-qualifies. (SQL 059)
//
// NO SIDE EFFECTS — the same discipline as platform-tn-report-back. It writes through the
// Metadata API, NOT danielle_schedule_parallel_job / reassign_job, both of which emit
// APPOINTMENT_SCHEDULED / TECH_ASSIGNED and would text a customer. Teddy's standing rule is no
// proactive customer texts, and a mirror-sync is the last thing that should trip one.
//
// WRITE SAFETY — Xano's content PUT REPLACES the row, so every write is a read-modify-write of
// the whole 127-column job. `?probe=` proves that round-trip is lossless before anything real
// moves. Terminal Xano jobs are never touched, and scheduling_status is only ever promoted FROM
// a pre-scheduled state — an awaiting_parts return trip keeps its parts state.
//
//   GET ?secret=<admin>&probe=<xano_id>   read-only: dump one Xano job's schedule fields
//   GET ?secret=<admin>&rmwtest=<xano_id>&confirm=yes   no-op read-modify-write, then diff
//   GET ?secret=<admin>&dryrun=1          show what WOULD be pushed, write nothing
//   GET ?secret=<admin>                   run (SHADOW unless PLATFORM_BOOKING_BACK_LIVE=true)
//   GET ?secret=<admin>&max=N             cap jobs touched in one run (default 40)
// Kill: vault PLATFORM_BOOKING_BACK_ENABLED=false
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const md = require('./_lib/xano/metadata-crud');

// VAPI_ADMIN_SECRET resolves from NEITHER the vault nor process.env on this site, so the mirror
// and both tees authenticate off this constant. Match them rather than inventing a third scheme.
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const JOBS_TABLE = 7;

const j = (code, body) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body, null, 1),
});
const s = (v) => String(v == null ? '' : v).trim();

// ── Central time, computed not hardcoded ────────────────────────────────────────────────────
// Xano stores scheduled_start as an epoch-MILLISECOND int and the office slot encoding is
// hour = 8 + (slot-1) CT. A hardcoded -5 breaks the moment DST flips, and a booking landing an
// hour off reads to a customer as us getting their appointment wrong.
function ctOffsetMs(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).forEach((x) => { if (x.type !== 'literal') p[x.type] = x.value; });
  let h = Number(p.hour); if (h === 24) h = 0;
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), h, Number(p.minute), Number(p.second)) - ms;
}
function ctMs(day, hour) {
  const want = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hour, 0, 0);
  let t = want;
  for (let i = 0; i < 3; i++) t = want - ctOffsetMs(t);   // converges in one, three is free
  return t;
}
// The three arrival windows the office actually books (ant-windows.js), plus the legacy shapes.
const WIN_HOUR = { '8-11': 8, '11-2': 11, '2-5': 14, am: 8, pm: 13, any: 8 };
const startHour = (win) => WIN_HOUR[String(win || '').toLowerCase()] || 8;

// Xano statuses we may PROMOTE to 'scheduled' when a day lands. Everything else keeps its own
// status: an awaiting_parts return trip stays awaiting_parts (it is still real parts state, and
// the Xano kanban shows that column anyway), and terminal jobs are skipped outright above.
const PROMOTE_FROM = ['', 'not_ready', 'needs_scheduled', 'needs_more_info', 'broadcasting', 'held'];
const TERMINAL = ['completed', 'canceled', 'no_fix_possible'];

async function sbCfg() {
  return {
    url: (await getSecret('PLATFORM_SUPABASE_URL')) || '',
    key: (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '',
  };
}

async function runBookingBack(q) {
  const dry = q.dryrun === '1' || q.dryrun === 'true';
  const max = Math.max(1, Math.min(200, Number(q.max || 40)));
  const live = String(await getSecretFresh('PLATFORM_BOOKING_BACK_LIVE') || '').toLowerCase() === 'true';
  const off = String(await getSecretFresh('PLATFORM_BOOKING_BACK_ENABLED') || '').toLowerCase() === 'false';
  if (off) return { ok: true, skipped: 'disabled' };

  const { url, key } = await sbCfg();
  if (!url || !key) return { ok: false, error: 'platform supabase not configured' };
  const H = { apikey: key, Authorization: 'Bearer ' + key };

  // 1) the pending set — exact, from the stamp. Never inferred.
  const sel = 'id,xano_id,scheduled_day,time_window,technician_id,status,platform_booked_at,platform_booked_pushed_at';
  const qs =
    `company_id=eq.${TN_COMPANY}&xano_id=not.is.null&platform_booked_at=not.is.null` +
    `&or=(platform_booked_pushed_at.is.null,platform_booked_pushed_at.lt.platform_booked_at)` +
    `&select=${sel}&order=platform_booked_at.asc&limit=${max}`;
  const pr = await fetch(`${url}/rest/v1/job?${qs}`, { headers: H, signal: AbortSignal.timeout(15000) });
  const pending = await pr.json().catch(() => null);
  if (!Array.isArray(pending)) return { ok: false, error: 'platform read failed', detail: String(pending).slice(0, 200) };

  // 2) platform tech uuid -> Xano tech int
  const tr = await fetch(`${url}/rest/v1/technician?company_id=eq.${TN_COMPANY}&select=id,xano_tech_id,name`, {
    headers: H, signal: AbortSignal.timeout(12000),
  });
  const techs = await tr.json().catch(() => []);
  const xanoTech = new Map();
  const techName = new Map();
  (Array.isArray(techs) ? techs : []).forEach((t) => {
    if (t.xano_tech_id != null) xanoTech.set(String(t.id), Number(t.xano_tech_id));
    techName.set(String(t.id), t.name || '');
  });

  const out = {
    ok: true, mode: dry ? 'dryrun' : (live ? 'live' : 'shadow'),
    pending: pending.length, pushed: 0, skipped: 0, plan: [], errors: [],
  };

  for (const p of pending) {
    const xid = Number(p.xano_id);
    let row;
    try {
      const rows = await md.search(JOBS_TABLE, { id: xid });
      row = (Array.isArray(rows) ? rows : []).find((r) => Number(r.id) === xid);
    } catch (e) {
      // NEVER assume "Xano has nothing" on a failed read — that is how you overwrite good data.
      out.errors.push({ job: xid, at: 'read_xano', err: String((e && e.message) || e).slice(0, 120) });
      continue;
    }
    if (!row) { out.skipped++; out.plan.push({ job: xid, action: 'skip', why: 'not_in_xano' }); continue; }

    const cur = String(row.scheduling_status || '').toLowerCase();
    if (TERMINAL.some((t) => cur.includes(t.slice(0, 6)))) {
      out.skipped++; out.plan.push({ job: xid, action: 'skip', why: 'xano_terminal:' + cur }); continue;
    }

    const day = s(p.scheduled_day);
    const patch = {};
    const why = [];

    if (day) {
      const wantMs = ctMs(day, startHour(p.time_window));
      if (Number(row.scheduled_start) !== wantMs) { patch.scheduled_start = wantMs; why.push('day->' + day + ' ' + (p.time_window || '8-11')); }
      const wantTech = p.technician_id ? xanoTech.get(String(p.technician_id)) : null;
      if (p.technician_id && wantTech == null) {
        // A platform-only tech with no xano_tech_id can never be represented in Xano. Say so
        // loudly rather than booking the job to nobody there.
        out.errors.push({ job: xid, at: 'tech_map', err: 'no xano_tech_id for ' + (techName.get(String(p.technician_id)) || p.technician_id) });
      } else if (wantTech != null && Number(row.technician_id) !== wantTech) {
        patch.technician_id = wantTech; why.push('tech->' + (techName.get(String(p.technician_id)) || wantTech));
      }
      if (PROMOTE_FROM.indexOf(cur) !== -1 && (patch.scheduled_start || patch.technician_id)) {
        patch.scheduling_status = 'scheduled'; why.push('status->scheduled');
      }
    } else {
      // Unschedule. Mirror-image of the book: clear the start so Xano's own
      // `scheduled_start > 0` test reads it as unscheduled, and drop the status back to the
      // pre-scheduled state so it lands in the office queue instead of sitting in Scheduled
      // with no day (which is exactly the 331-stale-job shape we are trying to stop creating).
      if (Number(row.scheduled_start) > 0) { patch.scheduled_start = 0; why.push('unschedule'); }
      if (cur === 'scheduled') { patch.scheduling_status = 'not_ready'; why.push('status->not_ready'); }
    }

    if (!Object.keys(patch).length) {
      // Already agrees — stamp it so it stops re-qualifying every run.
      out.skipped++; out.plan.push({ job: xid, action: 'noop', why: 'xano_already_matches' });
      if (!dry && live) await stampPushed(url, H, p.id);
      continue;
    }

    out.plan.push({ job: xid, action: 'push', changes: why, patch });
    if (dry || !live) continue;

    try {
      // Xano's content PUT replaces the row — send back everything we read, plus the change.
      const merged = Object.assign({}, row, patch);
      delete merged.id; delete merged.created_at;
      await md.update(JOBS_TABLE, xid, merged);
      await stampPushed(url, H, p.id);
      out.pushed++;
    } catch (e) {
      out.errors.push({ job: xid, at: 'write_xano', err: String((e && e.message) || e).slice(0, 160) });
    }
  }
  if (!live && !dry) out.note = 'SHADOW — set vault PLATFORM_BOOKING_BACK_LIVE=true to write to Xano';
  return out;
}

async function stampPushed(url, H, platformJobId) {
  await fetch(`${url}/rest/v1/job?id=eq.${platformJobId}`, {
    method: 'PATCH',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, H),
    body: JSON.stringify({ platform_booked_pushed_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(12000),
  }).catch(() => {});
}

// ── read-only probe + the lossless proof ────────────────────────────────────────────────────
async function probe(xid) {
  const rows = await md.search(JOBS_TABLE, { id: Number(xid) });
  const row = (Array.isArray(rows) ? rows : []).find((r) => Number(r.id) === Number(xid));
  if (!row) return { ok: false, error: 'not found in Xano' };
  return {
    ok: true, id: row.id, columns: Object.keys(row).length,
    scheduling_status: row.scheduling_status, current_status: row.current_status,
    scheduled_start: row.scheduled_start, technician_id: row.technician_id,
    claim_number: row.claim_number, problem_summary: String(row.problem_summary || '').slice(0, 60),
  };
}
// Proves the whole-row round trip loses nothing BEFORE any real booking moves. Writes the row
// back byte-identical, re-reads, and diffs every column.
async function rmwtest(xid) {
  const read = async () => {
    const rows = await md.search(JOBS_TABLE, { id: Number(xid) });
    return (Array.isArray(rows) ? rows : []).find((r) => Number(r.id) === Number(xid));
  };
  const before = await read();
  if (!before) return { ok: false, error: 'not found in Xano' };
  const merged = Object.assign({}, before);
  delete merged.id; delete merged.created_at;
  await md.update(JOBS_TABLE, Number(xid), merged);
  const after = await read();
  if (!after) return { ok: false, error: 'row vanished after write' };
  const diff = [];
  const keys = new Set(Object.keys(before).concat(Object.keys(after)));
  keys.forEach((k) => {
    const a = JSON.stringify(before[k] == null ? null : before[k]);
    const b = JSON.stringify(after[k] == null ? null : after[k]);
    if (a !== b) diff.push({ column: k, before: String(a).slice(0, 80), after: String(b).slice(0, 80) });
  });
  return { ok: true, id: xid, columns_before: Object.keys(before).length, columns_after: Object.keys(after).length, lossless: diff.length === 0, diff };
}

exports.runBookingBack = runBookingBack;

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || process.env.VAPI_ADMIN_SECRET || GUARD_FALLBACK;
  if (!q.secret || q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  try {
    if (q.probe) return j(200, await probe(q.probe));
    if (q.rmwtest) {
      if (q.confirm !== 'yes') return j(400, { ok: false, error: 'rmwtest writes the row back — add &confirm=yes' });
      return j(200, await rmwtest(q.rmwtest));
    }
    return j(200, await runBookingBack(q));
  } catch (e) {
    return j(500, { ok: false, error: String((e && e.message) || e) });
  }
};
