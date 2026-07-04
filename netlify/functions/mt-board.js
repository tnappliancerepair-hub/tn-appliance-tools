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
  const q = event.queryStringParameters || {};
  const key = String(q.key || '').toLowerCase();
  const p = PROJECTS[key];
  if (!p) return j(400, { ok: false, error: 'key must be one of ' + Object.keys(PROJECTS).join(',') });
  // Boards with many sections (TN=16) blow the 26s function cap when pulled at
  // the ~1.1s API pace. The client fetches SLICES in parallel (separate lambdas,
  // separate pace gates) and merges. from/to = section-index window.
  const from = Math.max(0, parseInt(q.from, 10) || 0);
  const to = q.to != null ? (parseInt(q.to, 10) || 0) : 999;
  try {
    let sections = await mt.listSections(p.id);
    sections = (Array.isArray(sections) ? sections : []).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    const total = sections.length;
    const slice = sections.slice(from, to);
    const status = String(q.status || 'actionable'); // server-side open-only filter (fast: skips years of archived cards)
    const columns = [];
    for (const s of slice) {
      let tasks = [];
      // Ask MeisterTask for ONLY the actionable (open) cards — otherwise mtList
      // pages through every archived card in the section (slow -> timeout).
      try { tasks = await mt.listSectionTasks(s.id, { params: { status } }); }
      catch (_) { try { tasks = await mt.listSectionTasks(s.id); } catch (_) {} } // fallback: unfiltered
      const cards = (Array.isArray(tasks) ? tasks : [])
        .filter((t) => Number(t.status) === 1) // belt+suspenders: keep only open
        .map((t) => ({ id: t.id, title: clean(t.name).slice(0, 120), notes: clean(t.notes).slice(0, 160) }));
      columns.push({ name: s.name, sequence: s.sequence, cards });
    }
    return j(200, { ok: true, key, name: p.name, total_sections: total, from, to, columns });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
