// knowledge-scorecard — the daily scoreboard for THE goal: be the most advanced
// troubleshooting brain in appliance repair. Every evening it measures the brain's
// depth + accuracy, tracks the trend, and texts the owner. "Getting smarter" stops
// being a vibe and becomes a number that must climb.
//
// Measures: fault codes known, components known, real jobs in the recall corpus,
// first-guess part accuracy (from the self-grading loop), open knowledge gaps, and
// gaps filled today. Stores a `knowledge_score` row so the trend is real.
//
//   GET ?secret=<admin>            compute + store + return JSON
//   GET ?secret=<admin>&text=1     also text the owner
//   GET ?secret=<admin>&days=7     include the N-day trend
//   (scheduled ~7:10PM CT: computes + stores + texts)
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const OWNER = '+16154855795';
const BASE = 'https://tnapplianceexchange.net/.netlify/functions';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function tsOf(r) { return Number(metaOf(r).at_ms) || Date.parse(r && r.created_at) || 0; }
function isoDateCT(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function dayCT(ms) { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms)); }
async function getJSON(url, ms) { try { const r = await fetch(url, { signal: AbortSignal.timeout(ms || 9000) }); return await r.json(); } catch (_) { return null; } }
const arrow = (d) => (d > 0 ? '▲+' + d : d < 0 ? '▼' + d : '±0');

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  // static KB depth (bundled, no I/O)
  let codes = 0, components = 0, models = 0, distilledJobs = 0;
  try { codes = (require('./_lib/ant/fault-codes.json').codes || []).length; } catch (_) {}
  try { const ck = require('./_lib/ant/component-knowledge'); components = (ck.COMPONENTS || []).length; } catch (_) {}
  try { const mk = require('./_lib/ant/model-knowledge'); const cov = mk.baseCoverage(); models = cov.models || 0; distilledJobs = cov.distilled_from || 0; } catch (_) {}

  // live signals
  const [brain, gapStats, embed] = await Promise.all([
    getJSON(`${BASE}/ant-brain-score`),
    getJSON(`${BASE}/knowledge-gap?stats=1&secret=${encodeURIComponent(admin)}`),
    getJSON(`${BASE}/hcp-embed?status=1&secret=${encodeURIComponent(admin)}`),
  ]);
  const accuracy = brain && Number.isFinite(brain.accuracy_pct) ? brain.accuracy_pct : null;
  const partAcc = brain && Number.isFinite(brain.part_accuracy_pct) ? brain.part_accuracy_pct : accuracy;
  const compAcc = brain && Number.isFinite(brain.component_accuracy_pct) ? brain.component_accuracy_pct : null;
  const usefulAcc = brain && Number.isFinite(brain.useful_accuracy_pct) ? brain.useful_accuracy_pct : null;
  const graded = (brain && brain.graded_total) || 0;
  const predictions = (brain && brain.predictions_made) || 0;
  const corpus = (embed && embed.embed && embed.embed.embedded) || 0;
  const gapsOpen = (gapStats && gapStats.open_gaps) || 0;
  const gapsFilled = (gapStats && gapStats.filled_today) || 0;
  const topGaps = (gapStats && gapStats.top) || [];

  const now = Date.now();
  const today = isoDateCT(now);
  const score = { date: today, at_ms: now, accuracy, part_accuracy: partAcc, component_accuracy: compAcc, useful_accuracy: usefulAcc, graded, predictions, corpus, codes, components, models, distilled_jobs: distilledJobs, gaps_open: gapsOpen, gaps_filled: gapsFilled };

  // prior score for the trend (last stored, different day)
  let trend = null, prior = null;
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'knowledge_score' }, { id: 'desc' }, 20);
    const mapped = rows.map(metaOf).filter((m) => m && m.date);
    prior = mapped.find((m) => m.date !== today) || null;
    if (q.days) trend = mapped.slice(0, Math.min(14, parseInt(q.days, 10) || 7)).map((m) => ({ date: m.date, accuracy: m.accuracy, corpus: m.corpus, codes: m.codes, gaps_open: m.gaps_open }));
  } catch (_) {}

  // store today's score (idempotent-ish: one per day is fine to append)
  try { await crud.logEvent('knowledge_score', score); } catch (_) {}

  // ── compose readout ──────────────────────────────────────────────
  const dModels = prior ? models - (prior.models || 0) : 0;
  const dCodes = prior ? codes - (prior.codes || 0) : 0;
  const dAcc = prior && accuracy != null && prior.accuracy != null ? accuracy - prior.accuracy : 0;
  // Honest breakdown: exact part is the strict number; right-component shows the brain
  // often knows WHAT failed even when the SKU differs; useful = either (the trip-saver).
  const dPart = prior && partAcc != null && prior.part_accuracy != null ? partAcc - prior.part_accuracy : (accuracy != null && prior && prior.accuracy != null ? dAcc : 0);
  const accStr = partAcc == null ? 'n/a'
    : `part ${partAcc}%${compAcc != null ? ` · component ${compAcc}%` : ''}${usefulAcc != null ? ` · useful ${usefulAcc}%` : ''} (${graded} graded)`;
  const lines = [
    `🧠 Ant Knowledge — ${dayCT(now)}`,
    `Models known: ${models.toLocaleString()} ${arrow(dModels)}${distilledJobs ? ` (from ${distilledJobs.toLocaleString()} distilled jobs)` : ''}`,
    `First-guess accuracy: ${accStr}${prior && partAcc != null && (prior.part_accuracy != null || prior.accuracy != null) ? ' ' + arrow(dPart) : ''}`,
    `Fault codes: ${codes} ${arrow(dCodes)} · Components: ${components}`,
    `Open gaps: ${gapsOpen}${gapsFilled ? ` · filled today: ${gapsFilled}` : ''}`,
  ];
  if (corpus) lines.push(`Semantic recall corpus: ${corpus.toLocaleString()} jobs`);
  if (predictions && !graded) lines.push(`${predictions} predictions awaiting outcome (grade them by closing TDRs)`);
  if (topGaps.length) lines.push('Fill next: ' + topGaps.slice(0, 3).map((g) => `${g.brand || '?'} ${g.code || g.model || ''} (×${g.count})`.trim()).join(' · '));
  lines.push('Goal: the most advanced troubleshooting brain in appliance repair.');
  const readout = lines.join('\n');

  let texted = false;
  if (scheduled || q.text === '1') {
    try { await sendSms(OWNER, readout, 'owner', 'knowledge_score'); texted = true; } catch (_) {}
  }
  return json(200, { ok: true, score, prior_date: prior && prior.date, deltas: { accuracy: dAcc, models: dModels, codes: dCodes }, top_gaps: topGaps, trend, readout, texted });
};
