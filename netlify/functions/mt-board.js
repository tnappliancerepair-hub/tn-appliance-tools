// mt-board — mirror ONE MeisterTask project's live board: its sections (columns)
// and the OPEN cards in each, so the practice board can render an exact copy.
//   GET ?key=tn|nola|sched   -> { ok, key, name, columns:[{name, cards:[{id,title,notes}]}] }
//
// Uses ONE project-wide task pull (status=actionable) grouped by section rather
// than one call per section — 16 slow section calls blew the function timeout;
// a single actionable pull of a project is a few pages. (2026-07-04)
'use strict';
const mt = require('./_lib/meistertask');

const PROJECTS = {
  sched: { id: 1964382, name: 'Scheduling' },
  tn:    { id: 2153288, name: 'TN Jobs' },
  nola:  { id: 8806934, name: 'NOLA Jobs' },
};

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const key = String(q.key || '').toLowerCase();
  const p = PROJECTS[key];
  if (!p) return j(400, { ok: false, error: 'key must be one of ' + Object.keys(PROJECTS).join(',') });
  const status = String(q.status || 'actionable'); // open cards only
  try {
    // Sections define the columns + their order.
    let sections = await mt.listSections(p.id);
    sections = (Array.isArray(sections) ? sections : []).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    const bySection = {}; // section_id -> {name, sequence, cards:[]}
    sections.forEach((s) => { bySection[String(s.id)] = { name: s.name, sequence: s.sequence, cards: [] }; });

    // ONE project-wide actionable pull, grouped by section (each task carries section_id).
    let tasks = [];
    try { tasks = await mt.listProjectTasks(p.id, { params: { status } }); }
    catch (_) { tasks = await mt.listProjectTasks(p.id); }
    for (const t of (Array.isArray(tasks) ? tasks : [])) {
      if (Number(t.status) !== 1) continue; // open only
      const sid = String(t.section_id);
      const col = bySection[sid];
      if (!col) continue;
      col.cards.push({ id: t.id, title: clean(t.name).slice(0, 120), notes: clean(t.notes).slice(0, 160) });
    }
    const columns = sections.map((s) => bySection[String(s.id)]);
    return j(200, { ok: true, key, name: p.name, columns });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
