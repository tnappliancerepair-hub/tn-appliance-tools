// squaretrade-autoassign — the fix for SquareTrade jobs landing "scheduled" (or
// needs_more_info) with NO tech and vanishing from the board. For each such job it
// routes to the AREA tech (check_service_zone → cluster rank-1), respecting day-off
// + the 6/day cap, falling to the next-rank tech in that cluster if the area tech is
// maxed/off, and flagging a human ONLY on a true exception (no coverage / all maxed).
// Then books it via danielle_schedule_parallel_job (tech + the dispatch date).
//
// Scoped to RECENT jobs (default last 5 days) so it never mass-touches the ancient
// backlog. Dryrun-first. Kill switch: vault SQUARETRADE_AUTOASSIGN=false.
//   GET ?dryrun=1   show the job→tech plan, assign nothing
//   GET ?days=5     lookback window
//   GET ?max=30     cap jobs per run
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OWNER = '+16154855795';
const CAP = 6;
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function authH() { return { Authorization: 'Bearer ' + process.env.XANO_METADATA_TOKEN, 'Content-Type': 'application/json' }; }
function ctDate(ms) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Number(ms))); } catch (_) { return ''; } }
const TERMINAL = new Set(['completed', 'canceled', 'cancelled', 'closed', 'no_fix_possible', 'in_progress']);

let _jt = null;
async function jobsTableId() {
  if (_jt) return _jt;
  for (let id = 1; id <= 70; id++) {
    try {
      const r = await fetch(`${META}/table/${id}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: 1, page: 1 }) });
      if (!r.ok) continue;
      const row = ((await r.json()).items || [])[0];
      if (row && 'customer_id' in row && 'scheduling_status' in row && 'warranty_company' in row) { _jt = id; return id; }
    } catch (_) {}
  }
  return null;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  // Runs on a schedule (cron) + manually. Safe to run openly: idempotent (only
  // acts on tech-less SquareTrade jobs, assigns them to their area tech — re-runs
  // find 0 candidates), and kill-switchable via the vault.
  if (String(await getSecret('SQUARETRADE_AUTOASSIGN') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  if (!process.env.XANO_METADATA_TOKEN) return json(500, { ok: false, error: 'no metadata token' });
  const dry = q.dryrun === '1';
  const days = Math.max(1, Math.min(30, parseInt(q.days, 10) || 5));
  const max = Math.min(parseInt(q.max, 10) || 30, 60);
  const sinceMs = Date.now() - days * 86400000;

  const jt = await jobsTableId();
  if (!jt) return json(500, { ok: false, error: 'could not resolve jobs table' });

  // 1) recent SquareTrade jobs missing a tech
  let rows = [];
  try { const r = await fetch(`${META}/table/${jt}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ search: { warranty_company: 'SquareTrade' }, sort: { id: 'desc' }, per_page: 150, page: 1 }) }); rows = ((await r.json()).items) || []; } catch (e) { return json(200, { ok: false, error: 'job search failed: ' + String(e.message || e) }); }
  const candidates = rows.filter((j) => {
    const created = j.created_at ? Number(j.created_at) : 0;
    if (created && created < sinceMs) return false;
    if (j.technician_id) return false;                         // already has a tech
    if (TERMINAL.has(String(j.current_status || '').toLowerCase()) || TERMINAL.has(String(j.scheduling_status || '').toLowerCase())) return false;
    if (!String(j.service_zip || '').trim()) return false;     // need a zip to route
    if (!j.scheduled_start) return false;                      // need the dispatch date
    return true;
  }).slice(0, max);

  // cache cluster ranks + per-tech-day capacity
  let clusterRanks = [];
  try { const r = await fetch(`${XANO}/list_cluster_assignments`).then((x) => x.json()); clusterRanks = (Array.isArray(r) ? r : (r.items || r.assignments || [])); } catch (_) {}
  const dashCache = {};
  async function dash(tid, date) {
    const k = tid + '|' + date; if (dashCache[k]) return dashCache[k];
    let d = { job_count: 99, day_off_active: false };
    try { d = await fetch(`${XANO}/get_tech_daily_dashboard?tech_id=${tid}&date=${date}`).then((x) => x.json()); } catch (_) {}
    dashCache[k] = d; return d;
  }

  const plan = [];
  for (const j of candidates) {
    const zip = String(j.service_zip).trim();
    const date = ctDate(j.scheduled_start);
    let zone = {};
    try { zone = await fetch(`${XANO}/check_service_zone?zip_code=${zip}`).then((x) => x.json()); } catch (_) {}
    if (!zone || !zone.covered) { plan.push({ job_id: j.id, zip, outcome: 'EXCEPTION: no coverage for zip', date }); continue; }
    // ranked techs for this cluster (active, non-owner), rank asc
    const ranked = clusterRanks.filter((c) => c.cluster === zone.cluster && c.active && c.tech_active && !c.is_owner).sort((a, b) => a.rank - b.rank);
    const order = ranked.length ? ranked : (zone.suggested_technician_id ? [{ technician_id: zone.suggested_technician_id, tech_name: zone.suggested_technician_name, rank: 1 }] : []);
    let chosen = null, reasons = [];
    for (const t of order) {
      const dd = await dash(t.technician_id, date);
      if (dd.day_off_active) { reasons.push(`${t.tech_name || t.technician_id}:day-off`); continue; }
      if ((dd.job_count || 0) >= CAP) { reasons.push(`${t.tech_name || t.technician_id}:maxed(${dd.job_count})`); continue; }
      chosen = { tech_id: t.technician_id, tech_name: t.tech_name, rank: t.rank, load: dd.job_count || 0 }; break;
    }
    if (!chosen) { plan.push({ job_id: j.id, zip, cluster: zone.cluster, date, outcome: 'EXCEPTION: all techs off/maxed', tried: reasons }); continue; }
    plan.push({ job_id: j.id, zip, cluster: zone.cluster, date, assign_to: chosen.tech_name, tech_id: chosen.tech_id, rank: chosen.rank, load_after: chosen.load + 1, outcome: 'assign' });
  }

  const toAssign = plan.filter((p) => p.outcome === 'assign');
  const exceptions = plan.filter((p) => String(p.outcome).startsWith('EXCEPTION'));

  if (dry) return json(200, { ok: true, mode: 'dryrun', candidates: candidates.length, would_assign: toAssign.length, exceptions: exceptions.length, plan });

  // 2) assign (book tech + the dispatch date)
  let assigned = 0; const failed = [];
  for (const p of toAssign) {
    const j = candidates.find((x) => x.id === p.job_id);
    try {
      const r = await fetch(`${XANO}/danielle_schedule_parallel_job`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: p.job_id, technician_id: p.tech_id, scheduled_start_ms: j.scheduled_start }), signal: AbortSignal.timeout(12000) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d && d.error == null) assigned++; else failed.push({ job: p.job_id, err: (d && d.error) || r.status });
    } catch (e) { failed.push({ job: p.job_id, err: String(e.message || e) }); }
  }
  // ping owner on any exception — but DEDUP per job so a stuck job alerts ONCE,
  // not every scheduled run (the spam Teddy saw: same #19978 over and over). A job
  // re-alerts only if it's still stuck 72h later.
  let warned = 0;
  if (exceptions.length) {
    const recentlyWarned = new Set();
    try {
      const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'sq_autoassign_warned' }, { id: 'desc' }, 60);
      const cut = Date.now() - 72 * 3600 * 1000;
      for (const r of rows || []) {
        if (Number(r.created_at || 0) && Number(r.created_at) < cut) continue;
        let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
        for (const id of (m && m.ids) || []) recentlyWarned.add(Number(id));
      }
    } catch (_) {}
    const freshEx = exceptions.filter((e) => !recentlyWarned.has(Number(e.job_id)));
    if (freshEx.length) {
      const body = `[ant] ⚠️ ${freshEx.length} SquareTrade job(s) couldn't auto-route to a tech (no coverage or all maxed) — need a human: ` + freshEx.slice(0, 6).map((e) => `#${e.job_id} ${e.zip}`).join(', ');
      try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: body, force_send: true, context_tag: 'sq_autoassign_exception' }) }); } catch (_) {}
      try { await crud.logEvent('sq_autoassign_warned', { ids: freshEx.map((e) => Number(e.job_id)), count: freshEx.length, at_ms: Date.now() }); } catch (_) {}
      warned = freshEx.length;
    }
  }
  return json(200, { ok: true, mode: 'live', assigned, failed: failed.length, exceptions: exceptions.length, warned, failed_list: failed.slice(0, 8), exception_list: exceptions.slice(0, 8) });
};
