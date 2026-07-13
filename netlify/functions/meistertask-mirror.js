// meistertask-mirror — bring the job board up to speed by MIRRORING MeisterTask's
// CURRENT columns onto the matching Xano jobs. Danielle keeps MeisterTask current
// and trusts it; the board drifted ("completely unkept"). This syncs the board's
// FOLDER PLACEMENT to match MeisterTask — and it does so WITHOUT ever creating a
// job, so it cannot manufacture a duplicate (her stated fear). It only sets the
// office_stage on jobs we can confidently match to a MeisterTask card by claim #.
//
//   GET ?probe=1&secret=            -> list MeisterTask projects + sections + open/archived counts (NO writes)
//   GET ?diff=1&secret=[&project=]  -> reconcile report: match every open card to a job, show would-moves (NO writes)
//   GET ?apply=1&secret=&confirm=yes[&project=][&names=1][&allow_paid=1]
//                                   -> apply office_stage placement for CLAIM-matched cards whose folder differs
//
// Matching is claim-number-first (near-zero false positives). Name-only matches are
// REPORTED for review and only applied with &names=1. Cards with no job match are
// listed as "missing from board" for a human to add — never auto-created.
'use strict';

const mt = require('./_lib/meistertask');
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const JOBS_TABLE = 7;
const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const j = (c, b) => ({ statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) });

const TECH_NAME = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };
const TECH_BY_NAME = { teddy: 1, jimmy: 2, andre: 3, lee: 4, billy: 5, john: 6 };

// ---- text helpers ---------------------------------------------------------
const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
const lc = (s) => String(s == null ? '' : s).toLowerCase();
// All digit-runs >=6 (claim #s / dispatch #s / work orders) found in a blob.
function claimCandidates(blob) {
  const out = new Set();
  const m = String(blob || '').match(/\d[\d\s-]{5,}\d/g) || [];
  for (const raw of m) { const d = raw.replace(/\D/g, ''); if (d.length >= 6 && d.length <= 14) out.add(d); }
  return [...out];
}
// Normalize a person's name to a comparable key: "smith|j" (last|firstInitial).
function nameKeys(first, last) {
  const f = lc(first).replace(/[^a-z]/g, ''); const l = lc(last).replace(/[^a-z]/g, '');
  const keys = new Set();
  if (l) { keys.add(l); if (f) keys.add(l + '|' + f[0]); }
  return keys;
}
// Pull a plausible "Last, First" or "First Last" out of a MeisterTask card title.
function parseCardName(title) {
  const t = String(title || '').split('\n')[0].trim();
  let m = t.match(/^([A-Za-z'’-]+)\s*,\s*([A-Za-z'’-]+)/);       // "Smith, John"
  if (m) return { first: m[2], last: m[1] };
  m = t.match(/^([A-Za-z'’-]+)\s+([A-Za-z'’-]+)/);                // "John Smith"
  if (m) return { first: m[1], last: m[2] };
  return { first: '', last: '' };
}

// ---- MeisterTask section name  ->  board folder ---------------------------
// Keyword-driven so it survives small column-name differences. Returns a folder
// id or null (unknown -> reported, never guessed into a move).
function sectionToFolder(sectionName) {
  const s = lc(sectionName);
  if (!s) return null;
  // A tech's own column. "Jimmy" / "Jimmy report" -> rep-2 ; "Jimmy invoice" -> inv-2.
  for (const [nm, id] of Object.entries(TECH_BY_NAME)) {
    if (s.includes(nm)) return (s.includes('invoice') || s.includes('bill')) ? ('inv-' + id) : ('rep-' + id);
  }
  if (s.includes('paid') || s.includes('closed') || s.includes('shop money')) return 'paid';
  if (s.includes('invoice') || (s.includes('need') && s.includes('bill'))) return 'needinv';
  if (s.includes('follow')) return 'followup';
  if (s.includes('complet') || s.includes('done') || s.includes('finish')) return 'done';
  if (s.includes('part') || s.includes('await') || s.includes('on order')) return 'parts';
  if ((s.includes('need') && s.includes('sched')) || s.includes('unschedul') || s.includes('to schedul') || s.includes('to be schedul')) return 'schedule';
  if (s.includes('sched') || s.includes('confirm') || s.includes('booked') || s.includes('route') || s.includes('today') || s.includes('tomorrow')) return 'scheduled';
  return null;
}
const folderLabel = (f) => {
  if (!f) return '(unknown)';
  if (f.startsWith('rep-')) return TECH_NAME[f.slice(4)] + ' · Report';
  if (f.startsWith('inv-')) return TECH_NAME[f.slice(4)] + ' · Invoice';
  return { schedule: 'Needs Scheduled', scheduled: 'Scheduled', parts: 'Waiting Parts', done: '✅ Completed', followup: 'Follow Up', needinv: 'Needs Invoice', paid: '💰 Paid' }[f] || f;
};

// ---- current board placement (mirror of placeOf, server side) -------------
const PARTS_ORDERED = /order|await|backorder|shipped|transit|on_?order/i;
function currentFolder(job) {
  const ov = String(job.office_stage || '').trim();
  if (ov) return ov;
  const ss = lc(job.scheduling_status), cs = lc(job.current_status);
  const hasTech = Number(job.technician_id) > 0;
  if (ss === 'completed' || cs === 'completed') return hasTech ? ('inv-' + job.technician_id) : 'done';
  const schedOrDone = ss === 'scheduled' || ss === 'completed' || cs === 'completed';
  if (!schedOrDone && (String(job.parts_eta_date || '').trim() || PARTS_ORDERED.test(job.parts_status || ''))) return 'parts';
  const started = ss === 'in_progress' || cs === 'in_progress';
  if (!started && (ss === 'scheduled' || (Number(job.scheduled_start) > 0 && ss !== 'not_ready' && cs !== 'not_ready'))) return 'scheduled';
  if (hasTech) return 'rep-' + job.technician_id;
  return 'schedule';
}

async function loadJobs() {
  const r = await fetch(XANO + '/get_office_kanban', { signal: AbortSignal.timeout(22000) });
  const d = await r.json().catch(() => ({}));
  const arr = Array.isArray(d) ? d : (d.jobs || d.items || d.result || []);
  return Array.isArray(arr) ? arr : [];
}

// Pull the OPEN cards of one project, tagged with their section name.
async function openCards(projectId) {
  const sections = await mt.listSections(projectId);
  const cards = [];
  for (const s of sections) {
    let tasks = [];
    try { tasks = await mt.listSectionTasks(s.id); } catch (_) {}
    for (const t of tasks) {
      if (Number(t.status) === 8) continue;                 // 8 = archived/trashed → not on the board now
      cards.push({ section: s.name || s.title || String(s.id), task: t });
    }
  }
  return cards;
}

async function pickProject(explicit) {
  const projects = await mt.listProjects();
  if (explicit) { const p = projects.find((x) => String(x.id) === String(explicit)); if (p) return { project: p, projects }; }
  // Auto: the project whose name reads like the active jobs board.
  const rank = (p) => { const n = lc(p.name || p.title); let r = 0; if (/schedul/.test(n)) r += 3; if (/tn|tennessee|jobs?/.test(n)) r += 2; if (/nola|louisiana/.test(n)) r += 1; return r; };
  const sorted = [...projects].sort((a, b) => rank(b) - rank(a));
  return { project: sorted[0], projects };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (String(q.secret || '') !== admin) return j(401, { ok: false, error: 'unauthorized' });
  if (!(await mt.isConfigured())) return j(200, { ok: false, error: 'meistertask_not_configured (set MEISTERTASK_TOKEN in the vault)' });

  // ---- PROBE: show the live board structure so we lock the section→folder map ----
  if (q.probe === '1') {
    try {
      const projects = await mt.listProjects();
      const detail = [];
      for (const p of projects) {
        let secs = [];
        try { secs = await mt.listSections(p.id); } catch (_) {}
        const sectionInfo = [];
        for (const s of secs) {
          let tasks = [];
          try { tasks = await mt.listSectionTasks(s.id); } catch (_) {}
          const open = tasks.filter((t) => Number(t.status) !== 8).length;
          sectionInfo.push({ section: s.name || s.title, open, archived: tasks.length - open, maps_to: folderLabel(sectionToFolder(s.name || s.title)) });
        }
        detail.push({ project_id: p.id, project: p.name || p.title, open_total: sectionInfo.reduce((a, s) => a + s.open, 0), sections: sectionInfo });
      }
      detail.sort((a, b) => b.open_total - a.open_total);
      return j(200, { ok: true, projects: detail });
    } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
  }

  if (q.diff !== '1' && q.apply !== '1') {
    return j(200, { ok: true, usage: 'add ?probe=1 (see boards) | ?diff=1 (reconcile, no writes) | ?apply=1&confirm=yes (place claim-matched cards)', secret: 'required' });
  }

  // ---- build the reconcile ----
  const { project } = await pickProject(q.project);
  if (!project) return j(200, { ok: false, error: 'no MeisterTask project found' });
  const [cards, jobs] = await Promise.all([openCards(project.id), loadJobs()]);

  // index jobs by claim digits + by name keys
  const byClaim = new Map(); const byName = new Map();
  for (const job of jobs) {
    const cd = digits(job.claim_number); if (cd.length >= 6) { if (!byClaim.has(cd)) byClaim.set(cd, job); }
    for (const k of nameKeys(job.customer_first, job.customer_last)) { if (!byName.has(k)) byName.set(k, job); }
  }

  const matchedAgree = [], wouldMove = [], nameMatches = [], missing = [], unknownSection = [];
  const seenJobIds = new Set();

  for (const c of cards) {
    const t = c.task;
    const folder = sectionToFolder(c.section);
    const blob = (t.name || '') + '\n' + (t.notes || t.description || '');
    // 1) claim match (confident)
    let job = null, via = '';
    for (const cd of claimCandidates(blob)) { if (byClaim.has(cd)) { job = byClaim.get(cd); via = 'claim'; break; } }
    // 2) name match (verify)
    if (!job) { const nm = parseCardName(t.name); for (const k of nameKeys(nm.first, nm.last)) { if (byName.has(k)) { job = byName.get(k); via = 'name'; break; } } }

    if (!job) { missing.push({ card: (t.name || '').slice(0, 80), section: c.section, folder: folderLabel(folder) }); continue; }
    seenJobIds.add(job.id);
    if (!folder) { unknownSection.push({ job_id: job.id, section: c.section }); continue; }

    const cur = currentFolder(job);
    const rec = {
      job_id: job.id, via, section: c.section,
      customer: ((job.customer_first || '') + ' ' + (job.customer_last || '')).trim(),
      from: folderLabel(cur), from_id: cur, to: folderLabel(folder), to_id: folder,
    };
    if (cur === folder) { matchedAgree.push(rec); }
    else if (via === 'claim') { wouldMove.push(rec); }
    else { nameMatches.push(rec); }
  }

  const summary = {
    ok: true, project: project.name || project.title, project_id: project.id,
    open_cards: cards.length, board_jobs: jobs.length,
    matched_and_agree: matchedAgree.length,
    would_move_claim: wouldMove.length,
    name_matches_review: nameMatches.length,
    unknown_section: unknownSection.length,
    missing_from_board: missing.length,
  };

  // move-direction breakdown so nothing scary applies blind
  const dir = {}; for (const m of wouldMove) { const k = m.from_id + ' → ' + m.to_id; dir[k] = (dir[k] || 0) + 1; }
  summary.move_breakdown = dir;

  if (q.diff === '1') {
    return j(200, { ...summary, would_move: wouldMove.slice(0, 200), name_matches: nameMatches.slice(0, 100), missing_from_board: missing.slice(0, 100), unknown_sections: unknownSection.slice(0, 40) });
  }

  // ---- APPLY (writes office_stage only; never creates a job) ----
  if (String(q.confirm || '') !== 'yes') return j(400, { ...summary, error: 'apply requires &confirm=yes' });
  const allowPaid = q.allow_paid === '1';                 // guard: don't yank money-collected cards backward unless told
  const doNames = q.names === '1';
  const queue = wouldMove.concat(doNames ? nameMatches : []);
  const applied = [], skipped = [];
  for (const m of queue) {
    if (!allowPaid && (m.from_id === 'paid' || m.from_id === 'done' || String(m.from_id).startsWith('inv-')) && m.to_id !== 'paid') { skipped.push({ ...m, why: 'money-side; needs &allow_paid=1' }); continue; }
    try {
      await crud.update(JOBS_TABLE, m.job_id, { office_stage: m.to_id });
      await crud.logEvent('office_stage_set', { job_id: m.job_id, stage: m.to_id, service_state: '', actor: 'meistertask-mirror' });
      applied.push({ job_id: m.job_id, to: m.to_id, via: m.via });
    } catch (e) { skipped.push({ ...m, why: String((e && e.message) || e) }); }
  }
  await crud.logEvent('meistertask_mirror_run', { project_id: project.id, applied: applied.length, skipped: skipped.length, names: doNames, allow_paid: allowPaid, at_ms: Date.now() });
  return j(200, { ...summary, applied: applied.length, skipped: skipped.length, applied_sample: applied.slice(0, 50), skipped_sample: skipped.slice(0, 50) });
};
