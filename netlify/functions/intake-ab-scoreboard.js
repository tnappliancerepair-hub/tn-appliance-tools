// intake-ab-scoreboard — which intake link style gets the most videos + availability
// back? intake-collector tags every send with a variant (video / ai / portal) via an
// `intake_ab_sent` event. This tallies, per variant: how many were sent, and how many
// of those jobs now have availability (customer_preference_text) and/or media. So we
// stop guessing which pitch/link converts and just SEE it. (Teddy 2026-07-02)
//   GET ?secret=<admin>[&days=14]
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const days = Math.max(1, Math.min(60, parseInt(q.days, 10) || 14));
  const since = Date.now() - days * 86400000;

  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'intake_ab_sent' }, { id: 'desc' }, 1000); } catch (_) {}

  // One entry per job (the variant is deterministic per job, so it's consistent).
  const byJob = {};
  for (const r of rows) {
    const m = meta(r);
    const at = Number(m.at_ms) || Number(r.created_at) || 0;
    if (at < since) continue;
    const jid = Number(m.job_id);
    if (!jid || byJob[jid]) continue;
    byJob[jid] = { variant: m.variant || '?' };
  }
  const jobIds = Object.keys(byJob).map(Number);

  const tally = {}; for (const v of ['video', 'ai', 'portal']) tally[v] = { sent: 0, availability: 0, media: 0 };
  // Check conversion per job (bounded so it never runs long).
  for (const jid of jobIds.slice(0, 250)) {
    const v = byJob[jid].variant; if (!tally[v]) tally[v] = { sent: 0, availability: 0, media: 0 };
    tally[v].sent++;
    let job = {}; try { job = await crud.searchOne(crud.TABLES.jobs, { id: jid }) || {}; } catch (_) {}
    if (String(job.customer_preference_text || '').trim() || String(job.customer_availability_grid || '').trim()) tally[v].availability++;
    if (job.has_video === true || Number(job.attachment_count) > 0 || String(job.media_status || '').toLowerCase() === 'received') tally[v].media++;
  }

  const out = {};
  let best = null;
  for (const v of Object.keys(tally)) {
    const t = tally[v];
    const ar = t.sent ? Math.round((100 * t.availability) / t.sent) : 0;
    out[v] = { ...t, availability_rate_pct: ar, media_rate_pct: t.sent ? Math.round((100 * t.media) / t.sent) : 0 };
    if (t.sent >= 5 && (!best || ar > best.rate)) best = { variant: v, rate: ar };
  }
  return json(200, {
    ok: true, days, jobs_measured: Math.min(jobIds.length, 250),
    variants: out,
    winner: best ? best.variant + ' (' + best.rate + '% gave availability)' : 'not enough data yet (need ~5+ sends per variant)',
    note: 'video = finish-upload page · ai = guided appliance-ai intake · portal = customer-portal',
  });
};
