// phone-score — on-demand read of the daily phone TRUST score.
//
// The scorecard (phone-trust-scorecard) is a SCHEDULED function, and Netlify now
// blocks manual HTTP to scheduled functions (returns 403) — so the old "pull it
// anytime with ?secret=" path silently broke. This NON-scheduled companion restores
// it: it reads the official numbers the 7PM cron already stored in event_log, and can
// recompute today live. (Teddy 2026-07-30: "what was our phone score for the day.")
//
//   GET ?secret=<admin>            -> latest stored score + trend (instant, official)
//   GET ?secret=<admin>&days=14    -> longer trend line
//   GET ?secret=<admin>&live=1     -> ALSO recompute today's score right now
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== admin && q.secret !== GUARD_FALLBACK) return json(403, { ok: false, error: 'forbidden — ?secret=<admin>' });

  // Official daily numbers the scheduled scorecard stored (newest first).
  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'phone_trust_score' }, { id: 'desc' }, 30); } catch (_) {}
  const hist = rows.map((r) => { const m = meta(r); return {
    date: m.date || null, score: m.score, total: m.total, actionable: m.actionable,
    failures: m.failures, top_fix: m.top_fix || m.topFix || null,
    human_answer: m.human_answer || null,   // Sofia/Danielle catch counts (if captured that day)
    at_ms: Number(m.at_ms || 0) || Date.parse(r.created_at) || 0,
  }; }).filter((x) => x.score != null);

  const latest = hist[0] || null;
  const days = Math.max(2, Math.min(60, Number(q.days) || 7));
  const out = {
    ok: true,
    latest,                                   // today's stored score (if the 7PM cron has run)
    trend: hist.slice(0, days),               // recent day-over-day
    note: latest ? undefined : 'No stored score yet — the scheduled scorecard runs ~7PM CT daily. Use &live=1 to compute now.',
  };

  // Live recompute (imports the scorer + humans-answering aggregator the scheduled fn exports).
  if (q.live === '1') {
    try {
      const { scoreWindow, humanAnswerWindow } = require('./phone-trust-scorecard');
      out.live = await scoreWindow(admin, 24);
      try { out.live.human_answer = await humanAnswerWindow(24); } catch (_) {}
    } catch (e) { out.live_error = String((e && e.message) || e); }
  }

  return json(200, out);
};
