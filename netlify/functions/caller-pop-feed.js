// caller-pop-feed — the laptop side of the screen-pop (Teddy 2026-08-12: "Danielle and
// Sofia mainly work on their laptops... this would be a game changer"). A tiny, non-
// intrusive corner widget polls this every few seconds; when a call comes in, the
// caller's whole story slides up in the corner with a one-tap link to their tile. It
// NEVER takes over the screen or interrupts what they're doing — they glance, tap, done.
//
// Returns the recent `caller_pop_sent` events (composed by caller-pop.js) as compact
// cards. The widget dedupes/dismisses client-side by `id`.
//
//   GET ?since_ms=<ms>&window_s=180   -> { pops: [{ id, at_ms, name, summary, link, header }] }
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  const windowS = Math.min(600, Math.max(30, Number(q.window_s) || 180));
  const sinceMs = Number(q.since_ms) || (Date.now() - windowS * 1000);

  let rows = [];
  try { rows = await crud.searchPage(crud.TABLES.event_log, { action: 'caller_pop_sent' }, { id: 'desc' }, 12); }
  catch (_) { return json(200, { pops: [], ok: false }); }

  const pops = [];
  for (const r of rows) {
    let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    m = m || {};
    const at = Number(m.at_ms || 0);
    if (at && at < sinceMs) continue;                 // older than the poll window — skip
    const name = String(m.name || 'Caller');
    const jobId = String(m.job_id || '');
    const claim = String(m.claim || '');
    const summary = String(m.summary || '');
    const digits = String(m.phone || '').replace(/\D/g, '');
    const link = jobId ? `/job-detail.html?job_id=${jobId}`
      : (claim ? `/warranty-review.html` : (digits ? `/customer-search.html?phone=${digits}` : '/office.html'));
    const header = claim ? `Warranty rep · WO ${claim}` : name;
    pops.push({ id: r.id, at_ms: at, name, summary, link, header, job_id: jobId, claim });
  }
  pops.reverse();                                     // oldest→newest so the widget stacks in order
  return json(200, { ok: true, now_ms: Date.now(), pops });
};
