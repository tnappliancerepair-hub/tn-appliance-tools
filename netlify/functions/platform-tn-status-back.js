// platform-tn-status-back — when a tech finishes a job ON THE PLATFORM, Xano finds out.
//
// The third and last leg of "Xano stays a complete backup" (bookings and reports already travel
// back). The mirror's never-walk-backwards guard keeps the platform's further-along state when
// Xano is behind - that guard is why a tech's completion survives here - but it only DEFENDS the
// platform, it never told Xano. Measured by platform-tn-parity the day this shipped: 11 jobs
// where the platform was ahead, FOUR of them completed by a tech here while Xano still had them
// scheduled or in progress. The backup did not know the work was done.
//
// FORWARD ONLY, using the mirror's own RANK. A job only ever moves along the lifecycle
// new -> scheduled -> in_progress -> awaiting_parts -> completed/canceled. If Xano is at or past
// the platform's state, nothing happens. This can never drag Xano backwards, which matters
// because Xano is still the system of record for everything else.
//
// COMPLETED IS THE CAREFUL ONE. A previous bulk status "repair" on this codebase nearly flipped
// ~73 genuinely-unfinished jobs to completed by trusting a derived signal. So a completion is
// only pushed when the platform carries a REAL completed_at stamp written by the tech's own
// Complete tap - never inferred from status alone.
//
// NO SIGNALS. Metadata API, not office_set_job_status. That matters more here than anywhere:
// office_set_job_status -> completed writes an event_log transition, job-completion-watch picks
// up anything inside a 36h window, and review-request-sweep texts the customer "how'd we do?".
// Pushing a backlog of completions through that path would text people about old work. A raw row
// write emits nothing.
//
//   GET ?secret=<admin>&dryrun=1   what WOULD change in Xano, writes nothing
//   GET ?secret=<admin>            run (SHADOW unless PLATFORM_STATUS_BACK_LIVE=true)
//   GET ?secret=<admin>&max=N      cap per run (default 25)
// Kill: vault PLATFORM_STATUS_BACK_ENABLED=false
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const md = require('./_lib/xano/metadata-crud');

const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const JOBS_TABLE = 7;

const j = (code, body) => ({ statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body, null, 1) });

// The mirror's own ordering, so "ahead" means the same thing on both sides of the bridge.
const RANK = { new: 0, scheduled: 1, in_progress: 2, awaiting_parts: 3, completed: 4, canceled: 4 };
// platform status -> the Xano scheduling_status the office board actually reads.
const TO_XANO = { scheduled: 'scheduled', in_progress: 'in_progress', awaiting_parts: 'awaiting_parts', completed: 'completed' };
// Same coarse bucketing the mirror uses to read Xano, so a naming difference is not mistaken
// for a real disagreement.
function coarse(x) {
  const s = String(x || '').toLowerCase();
  if (s.includes('complet')) return 'completed';
  if (s.includes('progress')) return 'in_progress';
  if (s.includes('await')) return 'awaiting_parts';
  if (s.includes('cancel')) return 'canceled';
  if (s === 'scheduled') return 'scheduled';
  return 'new';
}

async function runStatusBack(q) {
  const dry = q.dryrun === '1' || q.dryrun === 'true';
  const max = Math.max(1, Math.min(200, Number(q.max || 25)));
  const live = String(await getSecretFresh('PLATFORM_STATUS_BACK_LIVE') || '').toLowerCase() === 'true';
  if (String(await getSecretFresh('PLATFORM_STATUS_BACK_ENABLED') || '').toLowerCase() === 'false') {
    return { ok: true, skipped: 'disabled' };
  }

  const url = String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!url || !key) return { ok: false, error: 'platform supabase not configured' };
  const H = { apikey: key, Authorization: 'Bearer ' + key };

  // Only jobs the platform has moved along. xano_status is what the mirror last read FROM Xano,
  // so a disagreement with it is the platform having moved since — no extra Xano read to find
  // candidates, just one to confirm before writing.
  const r = await fetch(
    `${url}/rest/v1/job?company_id=eq.${TN_COMPANY}&xano_id=not.is.null` +
    `&status=in.(in_progress,awaiting_parts,completed)` +
    `&select=xano_id,status,xano_status,completed_at&order=xano_id.desc&limit=1000`,
    { headers: H, signal: AbortSignal.timeout(15000) },
  );
  const rows = await r.json().catch(() => null);
  if (!Array.isArray(rows)) return { ok: false, error: 'platform read failed' };

  const out = { ok: true, mode: dry ? 'dryrun' : (live ? 'live' : 'shadow'), scanned: rows.length, pushed: 0, skipped: 0, plan: [], errors: [] };

  for (const p of rows) {
    if (out.plan.length >= max) break;
    const here = String(p.status || '');
    const lastKnownXano = coarse(p.xano_status);
    if ((RANK[here] ?? -1) <= (RANK[lastKnownXano] ?? -1)) continue;   // Xano already at or past it

    // A completion must be a REAL one. Status alone is not enough - that assumption is what
    // nearly flipped ~73 unfinished jobs the last time someone bulk-repaired statuses.
    if (here === 'completed' && !p.completed_at) {
      out.skipped++;
      out.plan.push({ xano_id: p.xano_id, action: 'skip', why: 'completed with no completed_at stamp' });
      continue;
    }

    // Confirm against Xano NOW - xano_status is up to 5 minutes stale and the office may have
    // moved it in the meantime.
    let row;
    try {
      const hit = await md.search(JOBS_TABLE, { id: Number(p.xano_id) });
      row = (Array.isArray(hit) ? hit : []).find((x) => Number(x.id) === Number(p.xano_id));
    } catch (e) {
      out.errors.push({ xano_id: p.xano_id, at: 'read_xano', err: String((e && e.message) || e).slice(0, 120) });
      continue;
    }
    if (!row) { out.skipped++; continue; }

    const nowXano = coarse(row.scheduling_status);
    if ((RANK[here] ?? -1) <= (RANK[nowXano] ?? -1)) { out.skipped++; continue; }

    const patch = { scheduling_status: TO_XANO[here] || here };
    if (here === 'completed' && p.completed_at && !Number(row.job_completed_at)) {
      patch.job_completed_at = Date.parse(p.completed_at) || Date.now();
    }
    out.plan.push({ xano_id: p.xano_id, action: 'push', from: row.scheduling_status, to: patch.scheduling_status });
    if (dry || !live) continue;

    try {
      const merged = Object.assign({}, row, patch);
      delete merged.id; delete merged.created_at;
      await md.update(JOBS_TABLE, Number(p.xano_id), merged);
      out.pushed++;
    } catch (e) {
      out.errors.push({ xano_id: p.xano_id, at: 'write_xano', err: String((e && e.message) || e).slice(0, 160) });
    }
  }
  if (!live && !dry) out.note = 'SHADOW — set vault PLATFORM_STATUS_BACK_LIVE=true to write to Xano';
  return out;
}

exports.runStatusBack = runStatusBack;

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || process.env.VAPI_ADMIN_SECRET || GUARD_FALLBACK;
  if (!q.secret || q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  try { return j(200, await runStatusBack(q)); }
  catch (e) { return j(500, { ok: false, error: String((e && e.message) || e) }); }
};
