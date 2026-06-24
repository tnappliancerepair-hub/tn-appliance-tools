// servicepower-capacity — READ our ServicePower capacity (the "get more work" lever).
// Self-discovers our TechKeys from recent jobs (CallInfo carries TechKey/GroupKey), then
// getTechInfo per key → current weekly BasicCapacity {Capacity, Day, TimeBand}. Shows
// whether we're throttled and what to raise. READ-ONLY — never writes.
//
//   GET ?secret=<admin>            discover keys + read each tech's capacity
//   GET ?secret=<admin>&key=<K>    read one tech
//   GET ?secret=<admin>&days=N     job-scan window for key discovery (default 14)
'use strict';
const sp = require('./_lib/servicepower');
const { getSecret } = require('./_lib/secrets');
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

function windows(days, chunk) {
  const out = []; const now = Date.now(); const DAY = 86400000;
  const f = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()} 00:00:00`;
  for (let off = 0; off < days; off += chunk) out.push({ from: f(new Date(now - Math.min(off + chunk, days) * DAY)), to: f(new Date(now - off * DAY)) });
  return out;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: '?secret= required' });
  if (!(await sp.isConfigured())) return json(200, { ok: false, error: 'ServicePower creds not in vault' });

  // 1) discover TechKeys (+ GroupKeys) from recent jobs
  const keys = new Map();   // tech_key -> {group_key, jobs}
  const groups = new Set();
  if (!q.key) {
    const days = Math.min(parseInt(q.days || '14', 10) || 14, 45);
    try {
      for (const w of windows(days, 2)) {
        const r = await sp.getCallInfo({ fromDateTime: w.from, toDateTime: w.to });
        for (const c of (r.calls || [])) {
          if (c.group_key) groups.add(c.group_key);
          if (c.tech_key) { const e = keys.get(c.tech_key) || { group_key: c.group_key || '', jobs: 0 }; e.jobs++; keys.set(c.tech_key, e); }
        }
      }
    } catch (_) {}
  }
  // 2) read techs — by TechKey if we found any, else BY GROUP (our jobs are group-tagged)
  const techs = [];
  const seenKeys = new Set();
  async function readBy(opts, label) {
    let r; try { r = await sp.getTechInfo(opts); } catch (_) { r = {}; }
    for (const t of (r.techs || [])) {
      if (t.key && seenKeys.has(t.key)) continue; if (t.key) seenKeys.add(t.key);
      const byDay = {};
      for (const c of (t.basic_capacity || [])) { byDay[c.day || '?'] = byDay[c.day || '?'] || {}; byDay[c.day || '?'][c.time_band || '?'] = Number(c.capacity || 0); }
      techs.push({ via: label, tech_key: t.key, name: t.name, group_key: t.group_key, capacity_by_day: byDay });
    }
    return r;
  }
  let probe;
  if (q.key) { probe = await readBy({ key: q.key }, 'key'); }
  else {
    for (const k of [...keys.keys()].slice(0, 12)) await readBy({ key: k }, 'jobkey');
    if (!techs.length) { for (const g of [...groups].slice(0, 10)) await readBy({ groupKey: g }, 'group:' + g); }
  }

  return json(200, {
    ok: true,
    discovered_tech_keys: [...keys.entries()].map(([k, v]) => ({ tech_key: k, group_key: v.group_key, jobs: v.jobs })),
    group_keys: [...groups],
    time_bands: sp.TIME_BANDS,
    tech_count: techs.length,
    techs,
    last_err: probe && !techs.length ? { code: probe.err_code, desc: probe.err_desc, raw: (probe.raw || '').slice(0, 400) } : undefined,
    note: 'capacity_by_day = current weekly BasicCapacity. If techs is empty, capacity is set in the portal at a level the read API does not expose — grab it from the portal. To RAISE once we have a TechKey: updateTechCapacity (one date) / updateTechInfo (recurring).',
  });
};
