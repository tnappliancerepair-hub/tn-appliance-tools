// platform-tn-parity — "are we current?" answered with numbers instead of a feeling.
//
// TN is running BOTH systems during the migration: Xano is the old one and the backup, Supabase
// is where the work is moving. The whole plan rests on the two agreeing, and until now the only
// way to know was to eyeball a board. This diffs them and names every job that disagrees.
//
// It imports fetchActiveJobs and isRealJob FROM THE MIRROR on purpose. A parity check that
// re-implements the walk or the skip rule is measuring its own copy of the logic, not the
// mirror's - and would happily report "current" while the mirror quietly dropped a status.
//
// Three buckets, because "missing" is not one thing:
//   missing_real       a REAL Xano job the platform does not have -> an actual gap, act on it
//   skipped_shell      Xano's warranty-email artifacts (no name, no phone, no appliance). The
//                      mirror skips these deliberately; ~406 of them exist. Counted, never alarmed on.
//   status_drift       both have it, the statuses disagree -> usually a job mid-transition
//   platform_only_open an open job the old system has never heard of (the backup being incomplete)
//
//   GET ?secret=<admin>            full verdict
//   GET ?secret=<admin>&days=N     only jobs touched in the last N days (default 0 = all)
//   GET ?secret=<admin>&list=1     include the offending job ids
'use strict';

const { getSecret } = require('./_lib/secrets');
const mirror = require('./platform-tn-mirror');

const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';

const j = (code, body) => ({ statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body, null, 1) });

// Same mapping the mirror uses to bucket a Xano status into the platform's small set, so a
// drift report compares like with like instead of flagging every naming difference.
function coarse(x) {
  const s = String(x || '').toLowerCase();
  if (s.includes('complet')) return 'completed';
  if (s.includes('progress')) return 'in_progress';
  if (s.includes('await')) return 'awaiting_parts';
  if (s.includes('cancel')) return 'canceled';
  if (s === 'scheduled') return 'scheduled';
  return 'open';
}

async function runParity(q) {
  const days = Math.max(0, Math.min(365, Number(q.days || 0)));
  const withList = q.list === '1';
  const url = String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!url || !key) return { ok: false, error: 'platform supabase not configured' };
  const H = { apikey: key, Authorization: 'Bearer ' + key };

  // 1) Xano's side, through the mirror's own walk.
  const xano = await mirror.fetchActiveJobs();
  if (!Array.isArray(xano) || !xano.length) return { ok: false, error: 'xano_active_empty_or_failed' };

  // 2) the platform's side, paged - the 1,000-row cap would otherwise invent a gap out of thin air.
  const plat = new Map();
  for (let from = 0; from < 20000; from += 1000) {
    let rows = [];
    try {
      const r = await fetch(
        `${url}/rest/v1/job?company_id=eq.${TN_COMPANY}&xano_id=not.is.null&select=xano_id,status,xano_status&order=xano_id.asc`,
        { headers: Object.assign({ Range: `${from}-${from + 999}` }, H), signal: AbortSignal.timeout(15000) },
      );
      if (!r.ok) break;
      rows = await r.json().catch(() => []);
    } catch (_) { break; }
    if (!Array.isArray(rows) || !rows.length) break;
    rows.forEach((x) => plat.set(Number(x.xano_id), x));
    if (rows.length < 1000) break;
  }
  if (!plat.size) return { ok: false, error: 'platform_read_failed' };

  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const out = { missing_real: [], skipped_shell: 0, status_drift: [], checked: 0 };

  for (const x of xano) {
    const created = Number(x.created_at || 0);
    if (cutoff && created && created < cutoff) continue;
    out.checked++;
    const id = Number(x.id);
    const here = plat.get(id);
    if (!here) {
      // The mirror deliberately drops needs_more_info rows with no name, no phone and no
      // appliance - Xano's warranty-email intake turns notification emails into jobs. Those are
      // not a gap, they are the parking decision working.
      if (!mirror.isRealJob(x)) { out.skipped_shell++; continue; }
      out.missing_real.push({ xano_id: id, status: x.scheduling_status, who: [x.customer_first, x.customer_last].filter(Boolean).join(' '), appliance: x.appliance_type });
      continue;
    }
    const a = coarse(x.scheduling_status), b = String(here.status || '');
    if (a !== 'open' && a !== b) out.status_drift.push({ xano_id: id, xano: x.scheduling_status, platform: b });
  }

  // 4) the other direction: work the BACKUP has never heard of.
  let platformOnlyOpen = 0;
  try {
    const r = await fetch(
      `${url}/rest/v1/job?company_id=eq.${TN_COMPANY}&xano_id=is.null&status=not.in.(completed,canceled)&select=id`,
      { headers: Object.assign({ Prefer: 'count=exact' }, H), signal: AbortSignal.timeout(12000) },
    );
    const rows = await r.json().catch(() => []);
    platformOnlyOpen = Array.isArray(rows) ? rows.length : 0;
  } catch (_) {}

  const gaps = out.missing_real.length + platformOnlyOpen;
  return {
    ok: true,
    verdict: gaps === 0 ? 'CURRENT — both systems hold the same work' : 'GAP — ' + gaps + ' job(s) exist in only one system',
    window_days: days || 'all',
    xano_active: xano.length,
    platform_mirrored: plat.size,
    checked: out.checked,
    missing_from_platform: out.missing_real.length,
    platform_only_open: platformOnlyOpen,
    skipped_shells: out.skipped_shell,
    status_drift: out.status_drift.length,
    detail: withList ? { missing_from_platform: out.missing_real.slice(0, 50), status_drift: out.status_drift.slice(0, 50) } : undefined,
  };
}

exports.runParity = runParity;

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || process.env.VAPI_ADMIN_SECRET || GUARD_FALLBACK;
  if (!q.secret || q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  try { return j(200, await runParity(q)); }
  catch (e) { return j(500, { ok: false, error: String((e && e.message) || e) }); }
};
