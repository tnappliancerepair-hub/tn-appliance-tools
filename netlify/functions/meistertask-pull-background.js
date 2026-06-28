// meistertask-pull-background — pulls every project -> section -> task (and
// optionally comments) from MeisterTask via the API and stores them in the
// Supabase meistertask_archive table. The 7-year history rescue, no files.
//   GET ?secret=<admin>[&comments=1]
'use strict';

const { getSecret } = require('./_lib/secrets');
const mt = require('./_lib/meistertask');
const sb = require('./_lib/supabase');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TABLE = 'meistertask_archive';

function pick(o, keys) { for (const k of keys) { if (o && o[k] != null && String(o[k]).trim()) return String(o[k]); } return ''; }

async function pullAll({ withComments } = {}) {
  const projects = await mt.listProjects();
  const summary = { started_at: new Date().toISOString(), projects: [], total_tasks: 0 };
  for (const p of projects) {
    const board = pick(p, ['name', 'title']) || ('project-' + (p.id || ''));
    let tasks = [];
    try {
      const sections = await mt.listSections(p.id);
      for (const s of sections) { try { tasks.push(...await mt.listSectionTasks(s.id)); } catch (_) {} }
    } catch (_) {}
    if (!tasks.length) { try { tasks = await mt.listProjectTasks(p.id); } catch (_) {} }

    const rows = [];
    for (const t of tasks) {
      let card = t;
      if (withComments) { try { card = { ...t, _comments: await mt.listTaskComments(t.id) }; } catch (_) {} }
      rows.push({
        board, card_id: pick(t, ['id', 'token']),
        title: pick(t, ['name', 'title']).slice(0, 500),
        notes: pick(t, ['notes', 'description']).slice(0, 20000),
        card,
      });
    }
    for (let i = 0; i < rows.length; i += 200) { try { await sb.insert(TABLE, rows.slice(i, i + 200)); } catch (_) {} }
    summary.projects.push({ board, tasks: tasks.length });
    summary.total_tasks += tasks.length;
  }
  summary.finished_at = new Date().toISOString();
  try { await sb.insert(TABLE, { board: '_manifest', card_id: '', title: 'meistertask_pull', notes: '', card: summary }); } catch (_) {}
  return summary;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };
  if (!(await mt.isConfigured())) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'meistertask_not_configured (set MEISTERTASK_TOKEN)' }) };
  if (!(await sb.isConnected())) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'supabase_not_configured' }) };
  try {
    const summary = await pullAll({ withComments: !!q.comments });
    return { statusCode: 200, body: JSON.stringify({ ok: true, summary }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
