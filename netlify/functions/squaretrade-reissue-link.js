// squaretrade-reissue-link — links a SquareTrade/Allstate RETURN TRIP to the original
// job so the tech's work carries forward, while keeping the two jobs SEPARATE for
// billing (Teddy 2026-07-17). This is MeisterTask "relations" for the two-work-order
// flow: trip 1 (wrong part) bills $105 on WO#A, trip 2 (completion) bills $150 on WO#B.
//
// SquareTrade spells the link out. The reissue email (from appliance_team@squaretrade.com,
// subject "Service power-New Dispatch") reads:
//   "Please close out the original dispatch 052047584135 ..."
//   "We have created a new dispatch call number for an additional repair: 091466684132"
// So we parse the OLD WO + the NEW WO, find each job, and write a link marker. The UI
// then shows trip 1's diagnosis/parts/photos on trip 2's ticket (read-through) so the
// tech finishes instead of starting blank.
//
// NEVER merges or cancels — both jobs stay live + separately billable. Deterministic
// (the email names both numbers), so no heuristic guessing.
//
//   GET ?dry=1 (default)            show the plan, link nothing
//   GET ?confirm=1&secret=<admin>   link now
//   GET ?job_id=N                   resolve the link for one job (read; for the UI)
//   scheduled                       shadow-logs unless SQUARETRADE_REISSUE_LINK=true
'use strict';
const { readMany } = require('./_lib/gmail-accounts');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(b, null, 2) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

// Pull the OLD (close-out) + NEW (additional repair) dispatch numbers out of a reissue email.
function parseReissue(body) {
  const t = String(body || '');
  const orig = (t.match(/close\s+out\s+the\s+original\s+dispatch\s+(\d{6,})/i) || [])[1] || '';
  const nw = (t.match(/new\s+dispatch\s+call\s+number\s+for\s+an\s+additional\s+repair:?\s*(\d{6,})/i) || [])[1] || '';
  return { orig, nw };
}

// Find the REAL job carrying a work-order number (office search matches claim_number /
// dispatch_source_id / job_number). Skips the empty needs_more_info claim-shells that
// SquareTrade also spawns; prefers the job that holds actual work.
async function jobForWO(wo) {
  try {
    const d = await (await fetch(`${XANO}/office_universal_search?q=${encodeURIComponent(wo)}`, { signal: AbortSignal.timeout(9000) })).json();
    const items = (d.items || []).map((i) => ({
      id: Number(i.job_id || i.id),
      name: ((i.customer_first || '') + ' ' + (i.customer_last || '')).trim(),
      appliance: i.appliance || '',
      status: String(i.scheduling_status || '').toLowerCase(),
    })).filter((x) => x.id);
    // real = not a needs_more_info shell, has a name or appliance
    const real = items.filter((x) => x.status !== 'needs_more_info' && (x.name || x.appliance));
    const pool = real.length ? real : items;
    // furthest-along wins (a scheduled/awaiting_parts/completed job beats a fresh not_ready)
    const rank = (s) => ({ completed: 5, in_progress: 4, scheduled: 3, awaiting_parts: 3, not_ready: 1 }[s] || 2);
    pool.sort((a, b) => rank(b.status) - rank(a.status) || b.id - a.id);
    return pool[0] || null;
  } catch (_) { return null; }
}

async function alreadyLinked(origWO, newWO) {
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'squaretrade_return_trip' }, { id: 'desc' }, 500);
    return rows.some((r) => { const m = metaOf(r); return String(m.new_wo) === String(newWO) || (String(m.orig_wo) === String(origWO) && String(m.new_wo) === String(newWO)); });
  } catch (_) { return false; }
}

// Read side (for the UI): given a job, return its return-trip relationship + the PRIOR
// trip's diagnosis/parts summary so the ticket can show "continued from trip 1".
async function linkForJob(jobId) {
  let rows = [];
  try { rows = (await crud.searchPage(crud.TABLES.event_log, { action: 'squaretrade_return_trip' }, { id: 'desc' }, 500)) || []; } catch (_) {}
  for (const r of rows) {
    const m = metaOf(r);
    if (Number(m.new_job_id) === Number(jobId)) return { role: 'return_trip', orig_job_id: Number(m.orig_job_id), orig_wo: m.orig_wo, new_wo: m.new_wo };
    if (Number(m.orig_job_id) === Number(jobId)) return { role: 'original', new_job_id: Number(m.new_job_id), orig_wo: m.orig_wo, new_wo: m.new_wo };
  }
  return null;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';

  // ── read: one job's link (+ the prior trip's report, for the UI) ──
  if (q.job_id) {
    const link = await linkForJob(Number(q.job_id));
    if (!link) return j(200, { ok: true, linked: false });
    const priorId = link.orig_job_id || null;
    let prior = null;
    if (priorId) {
      try {
        const d = await (await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: priorId }) })).json();
        const t = (d && d.tdr) || {}; const a = (d && d.appliance) || {};
        prior = { job_id: priorId, wo: link.orig_wo, appliance: a.type || a.appliance_type || '', diagnosis: t.diagnosis || '', failed_component: t.failed_component || '', parts: t.verified_part_number || t.parts_needed || '', notes: t.technician_notes || '', repair_completed: t.repair_completed || '' };
      } catch (_) {}
    }
    return j(200, { ok: true, linked: true, link, prior });
  }

  // ── sweep: parse reissue emails, link pairs ──
  const isCron = !q.secret;
  if (!isCron && q.secret !== admin) return j(401, { ok: false, error: 'unauthorized — ?secret=' });
  const envLive = (await getSecret('SQUARETRADE_REISSUE_LINK')) === 'true';
  const live = q.dry === '1' ? false : (envLive || (q.secret === admin && q.confirm === '1'));

  let msgs = [];
  try {
    const res = await readMany('from:appliance_team@squaretrade.com "close out the original dispatch"', { max: 30 });
    msgs = Array.isArray(res) ? res : (res.matches || res.messages || []);
  } catch (e) { return j(200, { ok: false, error: 'gmail read failed: ' + String(e.message || e) }); }

  const plan = [];
  const seenPairs = new Set();
  for (const m of msgs) {
    const { orig, nw } = parseReissue(m.body || m.snippet || '');
    if (!orig || !nw || orig === nw) continue;
    const key = orig + '>' + nw;
    if (seenPairs.has(key)) continue; seenPairs.add(key);
    if (await alreadyLinked(orig, nw)) { plan.push({ orig_wo: orig, new_wo: nw, status: 'already_linked' }); continue; }
    const origJob = await jobForWO(orig);
    const newJob = await jobForWO(nw);
    plan.push({
      orig_wo: orig, new_wo: nw,
      orig_job: origJob ? { id: origJob.id, name: origJob.name, status: origJob.status } : null,
      new_job: newJob ? { id: newJob.id, name: newJob.name, status: newJob.status } : null,
      status: (origJob && newJob) ? 'READY' : 'waiting_for_jobs',
      date: m.date || '',
    });
  }

  const actionable = plan.filter((p) => p.status === 'READY');
  const out = { ok: true, mode: live ? 'LIVE' : (isCron ? 'shadow' : 'DRY'), reissue_emails: msgs.length, pairs: plan.length, ready: actionable.length, plan };
  if (!live) { out.note = isCron ? 'shadow — set SQUARETRADE_REISSUE_LINK=true to act' : 'DRY — add &confirm=1 to link'; return j(200, out); }

  let linked = 0;
  for (const p of actionable) {
    try {
      await crud.logEvent('squaretrade_return_trip', {
        orig_wo: p.orig_wo, new_wo: p.new_wo,
        orig_job_id: p.orig_job.id, new_job_id: p.new_job.id,
        customer: p.new_job.name || p.orig_job.name || '', at_ms: Date.now(),
      });
      linked++;
    } catch (e) { p.error = String(e.message || e); }
  }
  out.linked = linked;
  return j(200, out);
};

module.exports.parseReissue = parseReissue;   // unit-testable
