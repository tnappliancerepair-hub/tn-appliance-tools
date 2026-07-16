// followup-auto-advance — after 48 hours in Follow Up, a completed job auto-moves to
// Needs Invoice (Teddy 2026-07-16: "after follow-up we give the customer 48 hours, then
// it goes into needs invoiced — auto move it over"). Anchored on job_completed_at. Only
// touches jobs STILL in the Follow Up default (office_stage '' or 'followup') so it never
// overrides a placement the office made. Idempotent (once it's 'needinv' it's skipped).
//
//   scheduled (netlify.toml) · manual: ?secret=VAPI_ADMIN_SECRET[&dryrun=1]
'use strict';

const { getSecret } = require('./_lib/secrets');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const HOURS_48 = 48 * 60 * 60 * 1000;
const MAX_MOVE = 60;   // safety cap per run

function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled) {
    const guard = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
    if (q.secret !== guard) return j(403, { ok: false, error: 'forbidden' });
  }
  const dry = q.dryrun === '1';

  let jobs = [];
  try {
    const r = await fetch(`${XANO}/get_office_kanban`, { signal: AbortSignal.timeout(20000) });
    const d = await r.json();
    for (const k in d) { if (Array.isArray(d[k])) { jobs = d[k]; break; } }
  } catch (e) { return j(200, { ok: false, error: 'feed fetch failed' }); }

  const cutoff = Date.now() - HOURS_48;
  // A completed job still sitting in the Follow Up DEFAULT (no office placement, or an
  // explicit 'followup') whose completion was >48h ago.
  const due = jobs.filter((job) => {
    const ss = String(job.scheduling_status || '').toLowerCase(), cs = String(job.current_status || '').toLowerCase();
    if (ss !== 'completed' && cs !== 'completed') return false;
    const os = String(job.office_stage || '').trim().toLowerCase();
    if (os !== '' && os !== 'followup') return false;     // office moved it — leave it
    const done = Number(job.job_completed_at) || 0;
    return done > 0 && done <= cutoff;
  }).slice(0, MAX_MOVE);

  let moved = 0; const ids = [];
  for (const job of due) {
    ids.push(job.id);
    if (dry) continue;
    try {
      const r = await fetch(`${SITE}/.netlify/functions/office-stage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.id, stage: 'needinv', actor: 'auto-48h' }),
        signal: AbortSignal.timeout(9000),
      });
      if (r.ok) moved++;
    } catch (_) {}
  }

  return j(200, { ok: true, dry, due_count: due.length, moved, job_ids: ids });
};
