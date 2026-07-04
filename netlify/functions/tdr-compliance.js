// tdr-compliance — the "no report, no pay" + "stops filed" engine.
//
// The behavior lever (Teddy 7/4): a stop isn't done until its TDR is filed.
// This surfaces two truths from the data we already have:
//   • a TECH's pay that's waiting on an un-filed report (money on the counter)
//   • a per-tech "stops filed today" scoreboard (crew + owner visibility)
//
//   GET ?tech_id=4    -> { ok, tech_id, today:{stops,filed,pct}, holding:{count,amount},
//                          holding_jobs:[{job_id,customer,amount,when}], today_unfiled:[...] }
//   GET ?scope=today  -> { ok, date_ct, techs:[{tech_id,name,stops,filed,pct,unfiled:[{job_id,customer}]}] }
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const EVENT = 3, TDR_TABLE = 12;
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
const nonEmpty = (v) => { const s = String(v == null ? '' : v).trim(); return s !== '' && s.toLowerCase() !== 'null'; };
function ctDate(ms) { try { const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)); const g = (t) => (p.find((x) => x.type === t) || {}).value; return `${g('year')}-${g('month')}-${g('day')}`; } catch (_) { return ''; } }

async function metaSearch(tableId, body) {
  for (let a = 0; a < 2; a++) {
    try { const r = await fetch(`${META}/table/${tableId}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }); if (!r.ok) { if (a === 0) continue; return []; } return ((await r.json()).items) || []; }
    catch (_) { if (a === 0) continue; return []; }
  }
  return [];
}
async function actionRows(action, pages) {
  const out = [];
  for (let p = 1; p <= (pages || 3); p++) { const rows = await metaSearch(EVENT, { search: { action }, sort: { created_at: 'desc' }, per_page: 500, page: p }); out.push(...rows); if (rows.length < 500) break; }
  return out;
}

// job_id -> Set(tech_ids who filed a TDR row with real content). "Filed" = a
// diagnosis / repair / notes / failed-part is present (a bare pre-diagnosis with
// only a diagnosis line still counts, but Teddy's owner pre-diag is separated by
// author when we know the assigned tech).
async function tdrFiledSets() {
  const byJob = {};
  for (let p = 1; p <= 5; p++) {
    const rows = await metaSearch(TDR_TABLE, { sort: { id: 'desc' }, per_page: 500, page: p });
    for (const t of rows) {
      const jid = Number(t.job_id || 0); if (!jid) continue;
      const content = nonEmpty(t.diagnosis) || nonEmpty(t.repair_completed) || nonEmpty(t.technician_notes) || nonEmpty(t.failed_component);
      if (!content) continue;
      (byJob[jid] = byJob[jid] || new Set()).add(Number(t.technician_id || 0));
    }
    if (rows.length < 500) break;
  }
  return byJob;
}
// Is this job's report filed by the tech who owns it? Assigned tech's own report
// wins; otherwise any non-owner (non pre-diag) author counts. An owner-only
// pre-diagnosis (tech 1) does NOT count as the tech's filed report.
function jobFiled(byJob, jobId, assignedTech) {
  const s = byJob[Number(jobId)]; if (!s) return false;
  if (assignedTech && s.has(Number(assignedTech))) return true;
  for (const t of s) { if (t !== 1) return true; }
  return false;
}

function ctTodayMonday() {
  // this week's Monday in CT, YYYY-MM-DD.
  const today = ctDate(Date.now());
  const [y, m, d] = today.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dow = probe.getUTCDay(); // 0 Sun..6 Sat
  const back = (dow === 0 ? 6 : dow - 1);
  probe.setUTCDate(probe.getUTCDate() - back);
  return `${probe.getUTCFullYear()}-${String(probe.getUTCMonth() + 1).padStart(2, '0')}-${String(probe.getUTCDate()).padStart(2, '0')}`;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  const q = event.queryStringParameters || {};
  const todayCt = ctDate(Date.now());

  let byJob;
  try { byJob = await tdrFiledSets(); } catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }

  // Today's stops per tech (from the calendar week, filtered to today CT).
  let week = {};
  try { week = await fetch(`${XANO}/get_office_calendar_week?week_start=${ctTodayMonday()}`, { signal: AbortSignal.timeout(20000) }).then((r) => r.json()); } catch (_) { week = {}; }
  const techNames = {};
  for (const t of (week.technicians || [])) techNames[Number(t.id)] = ((t.first_name || t.name || ('Tech ' + t.id)) + '').trim();
  const todayJobs = (week.jobs || []).filter((jb) => ctDate(Number(jb.scheduled_start || 0)) === todayCt);
  const stopsByTech = {}; // tech_id -> { stops, filed, unfiled:[] }
  for (const jb of todayJobs) {
    const tid = Number(jb.technician_id || 0); if (!tid) continue;
    const b = stopsByTech[tid] || (stopsByTech[tid] = { stops: 0, filed: 0, unfiled: [] });
    b.stops++;
    const filed = jobFiled(byJob, jb.id, tid);
    if (filed) b.filed++;
    else b.unfiled.push({ job_id: jb.id, customer: `${(jb.customer_first_name || '').trim()} ${(jb.customer_last_name || '').trim()}`.trim() || 'Customer' });
  }

  // ── scoreboard mode ──
  if (String(q.scope || '') === 'today') {
    const KEEP = new Set([1, 2, 3, 4, 6]); // current field techs
    const techs = [];
    const ids = new Set([...Object.keys(stopsByTech).map(Number), ...KEEP]);
    for (const tid of ids) {
      if (!KEEP.has(tid)) continue;
      const b = stopsByTech[tid] || { stops: 0, filed: 0, unfiled: [] };
      techs.push({ tech_id: tid, name: techNames[tid] || ('Tech ' + tid), stops: b.stops, filed: b.filed, pct: b.stops ? Math.round((b.filed / b.stops) * 100) : 100, unfiled: b.unfiled });
    }
    techs.sort((a, b) => (a.pct - b.pct) || (b.stops - a.stops));
    return j(200, { ok: true, date_ct: todayCt, techs });
  }

  // ── per-tech (pay + own line) mode ──
  const techId = parseInt(q.tech_id, 10) || 0;
  if (!techId) return j(400, { ok: false, error: 'tech_id or scope=today required' });

  // Billed-but-unfiled = the tech's RECENT invoiced jobs with no filed report →
  // the current pay that's waiting on documentation. Scoped to a rolling window
  // (default 30d) so it's actionable, not an ancient backlog. Newest invoice per job.
  const days = Math.max(1, Math.min(120, parseInt(q.days, 10) || 30));
  const cutoff = Date.now() - days * 86400000;
  let invRows = [];
  try { invRows = await actionRows('office_invoice_logged', 4); } catch (_) {}
  const seen = new Set(); const holding = [];
  let holdingAmount = 0;
  for (const r of invRows) {
    const m = metaOf(r); if (parseInt(m.technician_id, 10) !== techId) continue;
    const jid = Number(m.job_id || 0); if (!jid || seen.has(jid)) continue; seen.add(jid);
    const when = num(m.logged_at_ms) || (r.created_at ? Date.parse(r.created_at) : 0);
    if (when && when < cutoff) continue;
    if (jobFiled(byJob, jid, techId)) continue;
    const pay = num(m.tech_pay) || num(m.labor);
    holding.push({ job_id: jid, amount: pay, when });
    holdingAmount += pay;
  }
  holding.sort((a, b) => b.when - a.when);

  const mine = stopsByTech[techId] || { stops: 0, filed: 0, unfiled: [] };
  return j(200, {
    ok: true, tech_id: techId,
    today: { stops: mine.stops, filed: mine.filed, pct: mine.stops ? Math.round((mine.filed / mine.stops) * 100) : 100 },
    today_unfiled: mine.unfiled,
    holding: { count: holding.length, amount: holdingAmount },
    holding_jobs: holding.slice(0, 20),
  });
};
