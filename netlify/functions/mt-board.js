// mt-board — mirror ONE MeisterTask project's live board: its sections (columns)
// and the OPEN cards in each, so the practice board can render an exact copy.
//   GET ?key=tn|nola|fl|sched   -> { ok, key, name, columns:[{name, cards:[{id,title,notes}]}] }
// Open cards only (status 1) = what's actually on the board right now, not the
// years of archived/completed cards.
'use strict';
const mt = require('./_lib/meistertask');

const PROJECTS = {
  sched: { id: 1964382, name: 'Scheduling' },
  tn:    { id: 2153288, name: 'TN Jobs' },
  fl:    { id: 6296548, name: 'Florida Jobs' },
  nola:  { id: 8806934, name: 'NOLA Jobs' },
};

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

exports.handler = async function (event) {
  const key = String((event.queryStringParameters || {}).key || '').toLowerCase();
  const p = PROJECTS[key];
  if (!p) return j(400, { ok: false, error: 'key must be one of ' + Object.keys(PROJECTS).join(',') });
  try {
    const sections = await mt.listSections(p.id);
    const columns = [];
    for (const s of (Array.isArray(sections) ? sections : [])) {
      let tasks = [];
      try { tasks = await mt.listSectionTasks(s.id); } catch (_) {}
      const cards = (Array.isArray(tasks) ? tasks : [])
        .filter((t) => Number(t.status) === 1) // open only
        .map((t) => ({ id: t.id, title: clean(t.name).slice(0, 120), notes: clean(t.notes).slice(0, 160) }));
      columns.push({ name: s.name, sequence: s.sequence, cards });
    }
    columns.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    return j(200, { ok: true, key, name: p.name, columns });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
