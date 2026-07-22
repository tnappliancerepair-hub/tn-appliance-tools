// mt-mirror — shared helpers for the MeisterTask → job-board placement mirror.
// Pure mapping/matching + the heavy reconcile, so the control function stays thin
// and the background worker does the slow live pull. Placement-only: never creates
// a job (zero duplicate risk).
'use strict';

const mt = require('./meistertask');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TECH_NAME = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };
const TECH_BY_NAME = { teddy: 1, jimmy: 2, andre: 3, lee: 4, john: 6 };

const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
const lc = (s) => String(s == null ? '' : s).toLowerCase();

function claimCandidates(blob) {
  const out = new Set();
  const m = String(blob || '').match(/\d[\d\s-]{5,}\d/g) || [];
  for (const raw of m) { const d = raw.replace(/\D/g, ''); if (d.length >= 6 && d.length <= 14) out.add(d); }
  return [...out];
}
// 10-digit US phones (or 11 with a leading 1) anywhere in the card — very reliable
// key when the claim # isn't on the card. Returns last-10-digit strings.
function phoneCandidates(blob) {
  const out = new Set();
  const m = String(blob || '').match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || [];
  for (const raw of m) { const d = raw.replace(/\D/g, ''); const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d; if (ten.length === 10 && ten[0] !== '0' && ten[0] !== '1') out.add(ten); }
  return [...out];
}
function nameKeys(first, last) {
  const f = lc(first).replace(/[^a-z]/g, ''); const l = lc(last).replace(/[^a-z]/g, '');
  const keys = new Set();
  if (l) { keys.add(l); if (f) keys.add(l + '|' + f[0]); }
  return keys;
}
function parseCardName(title) {
  let t = String(title || '').split('\n')[0];
  // Warranty cards are titled "New Dispatch Notification #NNN First Last" or
  // "ServicePower Call # NNN First Last" — strip the boilerplate + numbers first,
  // then take the first + last real word (handles "First & Spouse Last" couples).
  t = t.replace(/new dispatch notification/ig, ' ').replace(/dispatch notification/ig, ' ')
       .replace(/servicepower call/ig, ' ').replace(/service power/ig, ' ')
       .replace(/call\s*#?/ig, ' ').replace(/dispatch\s*#?/ig, ' ').replace(/claim\s*#?/ig, ' ')
       .replace(/#\s*[\d-]+/g, ' ').replace(/[#&,]/g, ' ');
  const stop = new Set(['the', 'and', 'nola', 'tn', 'la', 'cl', 'c', 'ahs', 'squaretrade', 'allstate', 'new', 'notification']);
  const words = (t.match(/[A-Za-z][A-Za-z'’-]{1,}/g) || []).filter((w) => !stop.has(w.toLowerCase()));
  if (words.length >= 2) return { first: words[0], last: words[words.length - 1] };
  if (words.length === 1) return { first: '', last: words[0] };
  return { first: '', last: '' };
}

function sectionToFolder(sectionName) {
  const s = lc(sectionName);
  if (!s) return null;
  // Ambiguous MeisterTask columns with NO safe board equivalent → leave unknown
  // (reported, never moved): a "Completion Appt" is a pending RETURN visit (not a
  // finished job — mapping to done would falsely mark it complete); autho/upgrade/
  // pre-post-diagnosis/templates have no board column.
  if (/completion\s*app|completion\s*appointment/.test(s)) return null;
  if (s.includes('autho') || s.includes('upgrade') || s.includes('diagnos') || s.includes('template')) return null;
  // A tech's own column. Invoice ONLY when the word "invoice" is present — do NOT
  // use "bill" as a keyword (it's a substring of the tech name "Billy").
  const inv = s.includes('invoice');
  for (const [nm, id] of Object.entries(TECH_BY_NAME)) { if (s.includes(nm)) return (inv ? 'inv-' : 'rep-') + id; }
  if (/\bte\b/.test(s)) return (inv ? 'inv-' : 'rep-') + 1;          // "TE" = Teddy's shop abbreviation
  if (s.includes('paid') || s.includes('closed') || s.includes('shop money')) return 'paid';
  if (/foll?ow/.test(s)) return 'followup';                          // catches "follow" + the "FOLOW UP" misspelling; before invoice
  if (inv || (s.includes('need') && s.includes('bill'))) return 'needinv';
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
      if (Number(t.status) === 8) continue;      // 8 = trashed
      cards.push({ section: s.name || s.title || String(s.id), task: t });
    }
  }
  return cards;
}
// MeisterTask task.status: 1 = actionable/open (what Danielle SEES on the board),
// 2 = completed/done-in-place (still in the column but finished — NOT active),
// 18/19/20 = section-completed variants. Only status 1 is "on the live board."
const ACTIVE_STATUS = new Set([1]);
const isActiveCard = (t) => ACTIVE_STATUS.has(Number(t && t.status));

// Resolve ?boards=tn,nola[,scheduling,florida] to project rows, in priority order
// (an active work-board placement wins over a stale needs-scheduled one). Default =
// the two drift-prone active work boards; Florida is a separate market (excluded).
const BOARD_MATCH = {
  tn: (n) => /\btn jobs\b/.test(n),
  nola: (n) => /nola/.test(n),
  scheduling: (n) => /^scheduling$/.test(n),
  florida: (n) => /florida/.test(n),
};
const BOARD_PRIORITY = ['tn', 'nola', 'scheduling', 'florida'];
async function resolveBoards(boardsCsv) {
  const projects = await mt.listProjects();
  const keys = String(boardsCsv || 'tn,nola').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const ordered = BOARD_PRIORITY.filter((k) => keys.includes(k));
  const out = [];
  for (const k of ordered) { const p = projects.find((x) => BOARD_MATCH[k] && BOARD_MATCH[k](lc(x.name || x.title))); if (p) out.push({ key: k, project: p }); }
  return out;
}

// Build the full reconcile between one-or-more MeisterTask boards and the job board.
// Cards are pulled per board in priority order; the FIRST board to claim a given
// job wins (so active placement beats a stale needs-scheduled), later dupes noted.
async function reconcile(boardsCsv) {
  const boards = await resolveBoards(boardsCsv);
  if (!boards.length) throw new Error('no matching MeisterTask boards for "' + (boardsCsv || 'tn,nola') + '"');
  const jobs = await loadJobs();

  const byClaim = new Map(); const byPhone = new Map(); const byName = new Map();
  for (const job of jobs) {
    const cd = digits(job.claim_number); if (cd.length >= 6 && !byClaim.has(cd)) byClaim.set(cd, job);
    const dp = digits(job.dispatch_source_id); if (dp.length >= 6 && !byClaim.has(dp)) byClaim.set(dp, job);   // match on dispatch# too (AHS/ServicePower cards carry it)
    const ph = digits(job.customer_phone).slice(-10); if (ph.length === 10 && !byPhone.has(ph)) byPhone.set(ph, job);
    for (const k of nameKeys(job.customer_first, job.customer_last)) { if (!byName.has(k)) byName.set(k, job); }
  }

  const matchedAgree = [], wouldMove = [], nameMatches = [], missing = [], unknownSection = [], conflicts = [];
  const claimedJob = new Map();          // job_id -> board key that already placed it
  const matchedJobIds = new Set();       // every board job a MT card matched
  const mtFolderCount = {};              // mapped folder -> # ACTIVE MT cards (MeisterTask's live count)
  const mtOnlyByFolder = {};             // folder -> # MT cards with NO board job (under-count)
  const mtOnlySamples = {};              // folder -> [card titles] causing the under-count
  const cardStatusHist = {};             // status value -> count (to verify what "active" means)
  let openCardTotal = 0, activeCardTotal = 0; const pulled = [];

  for (const b of boards) {
    let cards = []; try { cards = await openCards(b.project.id); } catch (e) { pulled.push({ board: b.key, error: String((e && e.message) || e) }); continue; }
    let activeHere = 0;
    for (const c of cards) {
      const t = c.task;
      const stv = String(Number(t.status || 0)); cardStatusHist[stv] = (cardStatusHist[stv] || 0) + 1;
      // Only status-1 (actionable) cards are on Danielle's LIVE board — completed/
      // done-in-place cards pile up in the column but aren't part of her worklist.
      if (!isActiveCard(t)) continue;
      activeHere++;
      const folder = sectionToFolder(c.section);
      if (folder) mtFolderCount[folder] = (mtFolderCount[folder] || 0) + 1;   // MT's authoritative per-column count
      const blob = (t.name || '') + '\n' + (t.notes || t.description || '');
      let job = null, via = '';
      for (const cd of claimCandidates(blob)) { if (byClaim.has(cd)) { job = byClaim.get(cd); via = 'claim'; break; } }
      if (!job) { for (const ph of phoneCandidates(blob)) { if (byPhone.has(ph)) { job = byPhone.get(ph); via = 'phone'; break; } } }
      if (!job) { const nm = parseCardName(t.name); for (const k of nameKeys(nm.first, nm.last)) { if (byName.has(k)) { job = byName.get(k); via = 'name'; break; } } }
      if (!job) {
        missing.push({ card: (t.name || '').slice(0, 80), board: b.key, section: c.section, folder: folderLabel(folder) });
        if (folder) { mtOnlyByFolder[folder] = (mtOnlyByFolder[folder] || 0) + 1; (mtOnlySamples[folder] = mtOnlySamples[folder] || []).push((t.name || '').slice(0, 50)); }
        continue;
      }
      if (claimedJob.has(job.id)) { conflicts.push({ job_id: job.id, first_board: claimedJob.get(job.id), also: b.key, section: c.section }); continue; }
      matchedJobIds.add(job.id);
      if (!folder) { unknownSection.push({ job_id: job.id, board: b.key, section: c.section }); claimedJob.set(job.id, b.key); continue; }
      claimedJob.set(job.id, b.key);
      const cur = currentFolder(job);
      const rec = { job_id: job.id, via, board: b.key, section: c.section, customer: ((job.customer_first || '') + ' ' + (job.customer_last || '')).trim(), from: folderLabel(cur), from_id: cur, to: folderLabel(folder), to_id: folder };
      if (cur === folder) matchedAgree.push(rec);
      else if (via === 'claim' || via === 'phone') wouldMove.push(rec);   // confident keys → auto-applyable
      else nameMatches.push(rec);                                          // name-only → review
    }
    openCardTotal += cards.length; activeCardTotal += activeHere;
    pulled.push({ board: b.key, project: b.project.name || b.project.title, open_cards: cards.length, active_cards: activeHere });
  }

  // Board side: where each active job actually sits + which are on the board with
  // NO MeisterTask card (the over-count). Skip canceled (they leave the board).
  const boardByFolder = {}; const boardOnlyByFolder = {}; const boardOnlySamples = {};
  for (const job of jobs) {
    const ss = lc(job.scheduling_status), cs = lc(job.current_status);
    if (/cancel/.test(ss) || /cancel/.test(cs)) continue;
    const f = currentFolder(job);
    boardByFolder[f] = (boardByFolder[f] || 0) + 1;
    if (!matchedJobIds.has(job.id)) {
      boardOnlyByFolder[f] = (boardOnlyByFolder[f] || 0) + 1;
      (boardOnlySamples[f] = boardOnlySamples[f] || []).push({ id: job.id, cust: ((job.customer_first || '') + ' ' + (job.customer_last || '')).trim(), status: job.scheduling_status || '', claim: job.claim_number || '', phone: String(job.customer_phone || '').replace(/\D/g, '').slice(-4) });
    }
  }

  // Per-column truth table: MeisterTask count vs board count + the gap makers.
  const folders = new Set([...Object.keys(mtFolderCount), ...Object.keys(boardByFolder)]);
  const column_reconcile = {};
  for (const f of folders) {
    column_reconcile[folderLabel(f)] = {
      folder_id: f, meistertask: mtFolderCount[f] || 0, board: boardByFolder[f] || 0, delta: (boardByFolder[f] || 0) - (mtFolderCount[f] || 0),
      board_extra_no_mt_card: boardOnlyByFolder[f] || 0, mt_missing_from_board: mtOnlyByFolder[f] || 0,
      board_only_samples: (boardOnlySamples[f] || []).slice(0, 25), mt_only_samples: (mtOnlySamples[f] || []).slice(0, 25),
    };
  }

  const dir = {}; for (const m of wouldMove) { const k = m.from_id + ' → ' + m.to_id; dir[k] = (dir[k] || 0) + 1; }
  const via = { claim: 0, phone: 0, name: 0 };
  for (const m of matchedAgree.concat(wouldMove, nameMatches)) { if (via[m.via] != null) via[m.via]++; }
  return {
    project: boards.map((b) => b.project.name || b.project.title).join(' + '), boards_pulled: pulled,
    open_cards: openCardTotal, active_cards: activeCardTotal, card_status_histogram: cardStatusHist, board_jobs: jobs.length,
    counts: { matched_and_agree: matchedAgree.length, would_move_claim: wouldMove.length, name_matches_review: nameMatches.length, unknown_section: unknownSection.length, missing_from_board: missing.length, cross_board_conflicts: conflicts.length, board_only_no_mt_card: Object.values(boardOnlyByFolder).reduce((a, n) => a + n, 0) },
    matched_via: via, move_breakdown: dir, column_reconcile,
    would_move: wouldMove, name_matches: nameMatches, missing, unknown_section: unknownSection, conflicts,
  };
}

module.exports = { sectionToFolder, folderLabel, currentFolder, reconcile, resolveBoards, openCards, loadJobs, TECH_NAME };
