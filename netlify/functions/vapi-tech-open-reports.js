'use strict';
// Vapi tool: get_my_open_reports — returns THIS tech's recent jobs whose report
// (TDR) is missing or incomplete, so the "Ant Tech Report" voice assistant can
// proactively sweep the tech's backlog: "by the way, you left Ms. Jones' Whirlpool
// dryer open yesterday — what was the issue?"
//
// Reuses get_techs_with_open_tdr (which already finds incomplete TDRs, per day,
// across all techs) for the last few days + filters to this tech. No new XS.
// Routed through vapi-tool (NETLIFY_TOOLS), so it receives flat args.
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

function ymdCT(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

exports.handler = async function (event) {
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const techId = Number(b.technician_id || b.tech_id || 0);
  if (!techId) return ok({ error: 'technician_id required', open_count: 0, reports: [] });
  const daysBack = Math.min(Math.max(Number(b.days_back || 3), 1), 7);

  const byJob = {};
  const now = Date.now();
  for (let i = 0; i < daysBack; i++) {
    const day = ymdCT(now - i * 86400000);
    try {
      const r = await fetch(`${XANO}/get_techs_with_open_tdr?today_ct=${day}`);
      const d = await r.json();
      const techs = (d && d.techs) || [];
      const mine = techs.find((t) => Number(t.tech_id) === techId);
      if (mine && Array.isArray(mine.jobs)) {
        for (const j of mine.jobs) {
          const id = Number(j.job_id);
          if (!id || byJob[id]) continue; // first (most recent day) wins
          byJob[id] = {
            job_id: id,
            customer: j.customer_first || '(customer)',
            appliance: j.appliance || 'appliance',
            when: i === 0 ? 'today' : (i === 1 ? 'yesterday' : day),
            filled_count: j.filled_count != null ? j.filled_count : null,
          };
        }
      }
    } catch (_) { /* skip a bad day, keep going */ }
  }

  const reports = Object.values(byJob);
  return ok({ open_count: reports.length, reports });
};

function ok(obj) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
