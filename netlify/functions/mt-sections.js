// mt-sections — one-off: dump the live MeisterTask project -> section (column)
// structure so we can mirror the board layout in a practice job board.
//   GET ?secret=VAPI_ADMIN_SECRET  -> { ok, projects:[{id,name,sections:[{id,name}]}] }
'use strict';
const mt = require('./_lib/meistertask');
const { getSecret } = require('./_lib/secrets');

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = '';
  try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  if (!admin) admin = 'tn-vapi-admin-9f83b1c4e7a206d5';
  if ((q.secret || '') !== admin) return j(401, { ok: false, error: 'unauthorized' });

  try {
    const projects = await mt.listProjects();
    const out = [];
    for (const p of (Array.isArray(projects) ? projects : [])) {
      let sections = [];
      try { sections = await mt.listSections(p.id); } catch (_) {}
      out.push({
        id: p.id,
        name: p.name,
        sections: (Array.isArray(sections) ? sections : []).map((s) => ({ id: s.id, name: s.name, sequence: s.sequence })),
      });
    }
    return j(200, { ok: true, projects: out });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
