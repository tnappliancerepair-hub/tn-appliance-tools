// v2-scoreboard — the "is v2 bulletproof yet?" number.
//
// Reads the v2_shadow_decisions ledger and reports how often the cloud-hosted
// v2 brain agreed with what the live system actually did. Watch tech_agreement
// climb; when it holds high across cash + warranty + phone for long enough,
// cut the intake→schedule slice over to v2 (with a rollback switch).
//
//   GET ?secret=<admin>[&days=14][&misses=1]
'use strict';
const supa = require('./_lib/supabase');
const { getSecret } = require('./_lib/secrets');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (!(await supa.isConnected())) return json(200, { ok: false, error: 'supabase_not_configured' });

  const days = Math.max(1, Math.min(90, parseInt(q.days, 10) || 14));
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();

  let rows = [];
  try { rows = await supa.select('v2_shadow_decisions', { created_at: `gte.${sinceIso}`, order: 'created_at.desc', limit: '5000' }); }
  catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }

  const status = {};            // counts per status
  const noFit = {};             // why v2 couldn't place
  const misses = [];
  // agreement tallied overall AND split by origin (queue vs awaiting_parts).
  const tally = { all: { rec: 0, tech: 0, day: 0, both: 0 }, queue: { rec: 0, tech: 0, day: 0, both: 0 }, awaiting_parts: { rec: 0, tech: 0, day: 0, both: 0 } };

  for (const r of rows) {
    status[r.status] = (status[r.status] || 0) + 1;
    if (r.status === 'no_fit' && r.no_fit_reason) noFit[r.no_fit_reason] = (noFit[r.no_fit_reason] || 0) + 1;
    if (r.status === 'reconciled') {
      const o = (r.origin === 'awaiting_parts') ? 'awaiting_parts' : 'queue';
      for (const k of ['all', o]) {
        tally[k].rec++;
        if (r.tech_match === true) tally[k].tech++;
        if (r.day_match === true) tally[k].day++;
        if (r.tech_match === true && r.day_match === true) tally[k].both++;
      }
      if (r.tech_match === false && misses.length < 40) misses.push({ origin: r.origin, job_id: r.job_id, predicted_tech: r.predicted_tech, actual_tech: r.actual_tech, predicted_day: r.predicted_day, actual_day: r.actual_day, zip: r.zip, city: r.city, appliance: r.appliance });
    }
  }
  const reconciled = tally.all.rec, techMatch = tally.all.tech, dayMatch = tally.all.day, bothMatch = tally.all.both;
  const agree = (t) => ({ tech: pct(t.tech, t.rec) + (t.rec ? '%' : ''), day: pct(t.day, t.rec) + (t.rec ? '%' : ''), tech_and_day: pct(t.both, t.rec) + (t.rec ? '%' : ''), reconciled: t.rec });

  const out = {
    ok: true,
    window_days: days,
    total_decisions: rows.length,
    by_status: status,
    reconciled,
    agreement: {
      tech: pct(techMatch, reconciled) + (reconciled ? '%' : ''),     // ← the headline number
      day: pct(dayMatch, reconciled) + (reconciled ? '%' : ''),
      tech_and_day: pct(bothMatch, reconciled) + (reconciled ? '%' : ''),
      _raw: { tech_match: techMatch, day_match: dayMatch, both: bothMatch, of: reconciled },
    },
    agreement_by_origin: {
      queue: agree(tally.queue),                       // intake → schedule
      awaiting_parts: agree(tally.awaiting_parts),     // part-arrived re-placement (the #19832 case)
    },
    placeable_predictions: status.predicted || 0,   // v2 had a real pick
    no_fit_breakdown: noFit,                          // where the feed has holes (unmapped zip, no tech, etc.)
    note: reconciled < 10
      ? `Only ${reconciled} reconciled so far — let it run a few days against live traffic before trusting the %.`
      : `tech_agreement is the bulletproof gauge. Hold it high across cash + warranty + phone, then cut over the intake→schedule slice.`,
  };
  if (q.misses === '1') out.misses = misses;
  return json(200, out);
};
