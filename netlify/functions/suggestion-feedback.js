// suggestion-feedback — shadow-mode scorecard. Logs whether the office accepted
// or rejected Ant's scheduling suggestion, and reports the agreement rate so we
// can watch Ant's accuracy vs. Danielle climb before it ever drives anything.
//
//   POST { job_id, outcome:'accepted'|'rejected', suggested_tech_id, suggested_date }
//   GET  -> { ok, accepted, rejected, total, rate_pct }

'use strict';

const crud = require('./_lib/xano/metadata-crud');

exports.handler = async function (event) {
  try {
    if (event.httpMethod === 'GET') {
      const [acc, rej] = await Promise.all([
        crud.searchPage(crud.TABLES.event_log, { action: 'ant_suggestion_accepted' }, { created_at: 'desc' }, 300),
        crud.searchPage(crud.TABLES.event_log, { action: 'ant_suggestion_rejected' }, { created_at: 'desc' }, 300),
      ]);
      const accepted = (acc || []).length, rejected = (rej || []).length, total = accepted + rejected;
      const rate = total ? Math.round((accepted / total) * 100) : null;
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, accepted, rejected, total, rate_pct: rate }) };
    }
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    const b = JSON.parse(event.body || '{}');
    const outcome = b.outcome === 'accepted' ? 'accepted' : (b.outcome === 'rejected' ? 'rejected' : null);
    if (!outcome) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'outcome must be accepted|rejected' }) };
    await crud.logEvent('ant_suggestion_' + outcome, {
      job_id: b.job_id, suggested_tech_id: b.suggested_tech_id || null, suggested_date: b.suggested_date || '',
      chosen_tech_id: b.chosen_tech_id || null, chosen_date: b.chosen_date || '', at_ms: Date.now(),
    });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, logged: outcome }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
