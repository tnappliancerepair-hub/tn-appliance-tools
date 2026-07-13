// mt-mirror — shared helpers for the MeisterTask → job-board placement mirror.
// Pure mapping/matching + the heavy reconcile, so the control function stays thin
// and the background worker does the slow live pull. Placement-only: never creates
// a job (zero duplicate risk).
'use strict';

const mt = require('./meistertask');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TECH_NAME = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };
const TECH_BY_NAME = { teddy: 1, jimmy: 2, andre: 3, lee: 4, billy: 5, john: 6 };

const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
const lc = (s) => String(s == null ? '' : s).toLowerCase();

function claimCandidates(blob) {
  const out = new Set();
  const m = String(blob || '').match(/\d[\d\s-]{5,}\d/g) || [];
  for (const raw of m) { const d = raw.replace(/\D/g, ''); if (d.length >= 6 && d.length <= 14) out.add(d); }
  return [...out];
}
function nameKeys(first, last) {
  const f = lc(first).replace(/[^a-z]/g, ''); const l = lc(last).replace(/[^a-z]/g, '');
  const keys = new Set();
  if (l) { keys.add(l); if (f) keys.add(l + '|' + f[0]); }
  return keys;
}
function parseCardName(title) {
  const t = String(title || '').split('\n')[0].trim();
  let m = t.match(/^([A-Za-z'’-]+)\s*,\s*([A-Za-z'’-]+)/);
  if (m) return { first: m[2], last: m[1] };
  m = t.match(/^([A-Za-z'’-]+)\s+([A-Za-z'’-]+)/);
  if (m) return { first: m[1], last: m[2] };
  return { first: '', last: '' };
}

function sectionToFolder(sectionName) {
  const s = lc(sectionName);
  if (!s) return null;
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
  if (String(f).startsWith('rep-')) return TECH_NAME[String(f).slice(4)] + ' · Report';
  if (String(f).startsWith('inv-')) return TECH_NAME[String(f).slice(4)] + ' · Invoice';
  return { schedule: 'Needs Scheduled', scheduled: 'Scheduled', parts: 'Waiting Parts', done: '✅ Completed', followup: 'Follow Up', needinv: 'Needs Invoice', paid: '💰 Paid' }[f] || f;
};

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

async function openCards(projectId) {
  const sections = await mt.listSections(projectId);
  const cards = [];
  for (const s of sections) {
    let tasks = [];
    try { tasks = await mt.listSectionTasks(s.id); } catch (_) {}
    for (const t of tasks) {
      if (Number(t.status) === 8) continue;
      cards.push({ section: s.name || s.title || String(s.id), task: t });
    }
  }
  return cards;
}

async function pickProject(explicit) {
  const projects = await mt.listProjects();
  if (explicit) { const p = projects.find((x) => String(x.id) === String(explicit)); if (p) return { project: p, projects }; }
  const rank = (p) => { const n = lc(p.name || p.title); let r = 0; if (/schedul/.test(n)) r += 3; if (/tn|tennessee|jobs?/.test(n)) r += 2; if (/nola|louisiana/.test(n)) r += 1; return r; };
  const sorted = [...projects].sort((a, b) => rank(b) - rank(a));
  return { project: sorted[0], projects };
}

// Build the full reconcile between a MeisterTask project and the current board.
async function reconcile(projectId) {
  const { project } = await pickProject(projectId);
  if (!project) throw new Error('no MeisterTask project found');
  const [cards, jobs] = await Promise.all([openCards(project.id), loadJobs()]);

  const byClaim = new Map(); const byName = new Map();
  for (const job of jobs) {
    const cd = digits(job.claim_number); if (cd.length >= 6 && !byClaim.has(cd)) byClaim.set(cd, job);
    for (const k of nameKeys(job.customer_first, job.customer_last)) { if (!byName.has(k)) byName.set(k, job); }
  }

  const matchedAgree = [], wouldMove = [], nameMatches = [], missing = [], unknownSection = [];
  for (const c of cards) {
    const t = c.task;
    const folder = sectionToFolder(c.section);
    const blob = (t.name || '') + '\n' + (t.notes || t.description || '');
    let job = null, via = '';
    for (const cd of claimCandidates(blob)) { if (byClaim.has(cd)) { job = byClaim.get(cd); via = 'claim'; break; } }
    if (!job) { const nm = parseCardName(t.name); for (const k of nameKeys(nm.first, nm.last)) { if (byName.has(k)) { job = byName.get(k); via = 'name'; break; } } }
    if (!job) { missing.push({ card: (t.name || '').slice(0, 80), section: c.section, folder: folderLabel(folder) }); continue; }
    if (!folder) { unknownSection.push({ job_id: job.id, section: c.section }); continue; }
    const cur = currentFolder(job);
    const rec = { job_id: job.id, via, section: c.section, customer: ((job.customer_first || '') + ' ' + (job.customer_last || '')).trim(), from: folderLabel(cur), from_id: cur, to: folderLabel(folder), to_id: folder };
    if (cur === folder) matchedAgree.push(rec);
    else if (via === 'claim') wouldMove.push(rec);
    else nameMatches.push(rec);
  }
  const dir = {}; for (const m of wouldMove) { const k = m.from_id + ' → ' + m.to_id; dir[k] = (dir[k] || 0) + 1; }
  return {
    project: project.name || project.title, project_id: project.id,
    open_cards: cards.length, board_jobs: jobs.length,
    counts: { matched_and_agree: matchedAgree.length, would_move_claim: wouldMove.length, name_matches_review: nameMatches.length, unknown_section: unknownSection.length, missing_from_board: missing.length },
    move_breakdown: dir,
    would_move: wouldMove, name_matches: nameMatches, missing, unknown_section: unknownSection,
  };
}

module.exports = { sectionToFolder, folderLabel, currentFolder, reconcile, pickProject, openCards, loadJobs, TECH_NAME };
