// meistertask-mirror — bring the job board up to speed by MIRRORING MeisterTask's
// CURRENT columns onto matching Xano jobs. Danielle keeps MeisterTask current and
// trusts it; the board drifted ("completely unkept"). This syncs the board's
// FOLDER PLACEMENT to match MeisterTask — WITHOUT ever creating a job, so it
// cannot manufacture a duplicate (her stated fear). It only sets office_stage on
// jobs we confidently match to a MeisterTask card by claim #.
//
//   GET ?probe=1&secret=[&project=&full=1] -> projects + section names (+opt open counts). FAST, no writes.
//   GET ?diff=1&secret=[&project=]          -> kick the reconcile (background). Read it with ?report=1.
//   GET ?apply=1&secret=&confirm=yes[&project=&names=1&allow_paid=1] -> kick apply (background).
//   GET ?report=1&secret=                   -> read the latest diff/apply result.
// The heavy live pull runs in meistertask-mirror-background (15-min budget); this
// endpoint stays fast so it never times out on a 1,000+ card board.
'use strict';

const mt = require('./_lib/meistertask');
const mm = require('./_lib/mt-mirror');
const sb = require('./_lib/supabase');
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const SITE = (process.env.URL || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
const ARCHIVE = 'meistertask_archive';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const j = (c, b) => ({ statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) });

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (String(q.secret || '') !== admin) return j(401, { ok: false, error: 'unauthorized' });
  if (!(await mt.isConfigured())) return j(200, { ok: false, error: 'meistertask_not_configured (set MEISTERTASK_TOKEN in the vault)' });

  // ---- PROBE: live board structure (section NAMES only = fast) ----
  if (q.probe === '1') {
    try {
      const projects = await mt.listProjects();
      const detail = [];
      for (const p of projects) {
        if (q.project && String(p.id) !== String(q.project)) continue;
        let secs = []; try { secs = await mt.listSections(p.id); } catch (_) {}
        const sections = [];
        for (const s of secs) {
          const row = { section: s.name || s.title, maps_to: mm.folderLabel(mm.sectionToFolder(s.name || s.title)) };
          if (q.full === '1' && q.project) { let tasks = []; try { tasks = await mt.listSectionTasks(s.id); } catch (_) {} row.open = tasks.filter((t) => Number(t.status) !== 8).length; row.archived = tasks.length - row.open; }
          sections.push(row);
        }
        detail.push({ project_id: p.id, project: p.name || p.title, section_count: sections.length, sections });
      }
      return j(200, { ok: true, projects: detail });
    } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
  }

  // ---- REPORT: read the latest background result ----
  if (q.report === '1') {
    try {
      if (await sb.isConnected()) {
        const rows = await sb.select(ARCHIVE, { board: 'eq._mirror_report', order: 'id.desc', limit: '1' }).catch(() => []);
        if (rows && rows[0] && rows[0].card) return j(200, rows[0].card);
      }
    } catch (_) {}
    // fallback: compact breadcrumb from event_log
    try {
      const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'meistertask_mirror_report' }, { id: 'desc' }, 1);
      let m = rows && rows[0] && rows[0].metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) {} }
      if (m) return j(200, { ok: true, note: 'compact breadcrumb (full report in Supabase was unavailable)', ...m });
    } catch (_) {}
    return j(200, { ok: false, error: 'no report yet — run ?diff=1 first, then read ?report=1 in ~1-2 min' });
  }

  // ---- DIFF / APPLY: fire the background worker, return immediately ----
  if (q.diff === '1' || q.apply === '1') {
    if (q.apply === '1' && String(q.confirm || '') !== 'yes') return j(400, { ok: false, error: 'apply requires &confirm=yes' });
    const mode = q.apply === '1' ? 'apply' : 'diff';
    const params = new URLSearchParams({ secret: admin, mode });
    if (q.boards) params.set('boards', q.boards);
    if (mode === 'apply') { params.set('confirm', 'yes'); if (q.names === '1') params.set('names', '1'); if (q.allow_paid === '1') params.set('allow_paid', '1'); }
    try { await fetch(`${SITE}/.netlify/functions/meistertask-mirror-background?${params.toString()}`, { signal: AbortSignal.timeout(6000) }).catch(() => {}); } catch (_) {}
    return j(200, { ok: true, triggered: true, mode, read: '/.netlify/functions/meistertask-mirror?report=1&secret=…', note: 'result lands in ~1-2 min (big board is rate-limited)' });
  }

  return j(200, { ok: true, usage: '?probe=1 (boards) | ?diff=1 then ?report=1 (reconcile) | ?apply=1&confirm=yes (place claim-matched)' });
};
