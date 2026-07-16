// multi-appliance-split-sweep — scan the live board for multi-item jobs ("dryer/washer",
// "washer / dishwasher", …) that landed as ONE job, and split the extra appliances into
// their own linked jobs so the tech sees every appliance as its own stop (each with its own
// TDR for warranty). DRY-RUN by default; runs live only with the admin secret + confirm.
//
//   GET ?secret=<admin>            -> dry run: lists what WOULD be split
//   GET ?secret=<admin>&confirm=1  -> live: actually splits them
// Safe: idempotent per job (skips appliances already split), never touches terminal jobs.
'use strict';
const { detectAppliances, splitJob, TERMINAL } = require('./_lib/appliance-split');
const { getSecret } = require('./_lib/secrets');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
exports.config = { timeout: 60 };

// Pull every job object out of the kanban payload (it groups jobs under several keys).
function collectJobs(d) {
  const out = [];
  const push = (arr) => { for (const j of arr) if (j && typeof j === 'object' && (('appliance_type' in j) || ('appliance' in j)) && (j.id || j.job_id)) out.push(j); };
  if (d && typeof d === 'object') for (const v of Object.values(d)) if (Array.isArray(v)) push(v);
  // dedup by id
  const seen = new Set(); const uniq = [];
  for (const j of out) { const id = j.id || j.job_id; if (!seen.has(id)) { seen.add(id); uniq.push(j); } }
  return uniq;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const live = q.confirm === '1' || process.env.MULTI_APPLIANCE_SPLIT_LIVE === 'true';

  let jobs;
  try {
    const r = await fetch(`${XANO}/get_office_kanban`, { signal: AbortSignal.timeout(25000) });
    jobs = collectJobs(await r.json());
  } catch (e) { return json(200, { ok: false, error: 'kanban fetch failed: ' + ((e && e.message) || e) }); }

  // candidates: splittable label + non-terminal status
  const candidates = [];
  for (const j of jobs) {
    const label = j.appliance_type || j.appliance || '';
    const det = detectAppliances(label);
    if (!det.splittable) continue;
    const status = String(j.scheduling_status || j.current_status || '').toLowerCase();
    if (TERMINAL.indexOf(status) >= 0) continue;
    candidates.push({ job_id: j.id || j.job_id, label, appliances: det.appliances, status });
  }

  // process (splitJob re-reads + re-validates each job; idempotent)
  const results = [];
  for (const c of candidates) {
    try { results.push(await splitJob(c.job_id, { live })); }
    catch (e) { results.push({ job_id: c.job_id, ok: false, error: (e && e.message) || String(e) }); }
  }

  const createdCount = results.reduce((n, r) => n + ((r && r.created) ? r.created.filter((x) => x.job_id).length : 0), 0);
  return json(200, {
    ok: true,
    mode: live ? 'LIVE' : 'DRY RUN (add &confirm=1 to split)',
    scanned: jobs.length,
    candidate_count: candidates.length,
    candidates,
    would_create_or_created: createdCount,
    results,
  });
};
