// platform-warranty-tee-background — the tee with a 15-minute allowance, for replaying a
// wide window. The sync core cannot do this job: a four-inbox FULL-FORMAT Gmail read can
// eat its entire allowance before the first intake call, so the batch gets killed partway
// and the caller sees a reset connection with no idea how far it got.
//
// Netlify returns 202 immediately and runs this detached, so there is nothing useful in the
// response. Verify a run by reading the BOARD, never by what came back.
//
//   GET ?secret=<admin>&q=<gmail query>[&max=N][&dryrun=1]
'use strict';
const { runTee } = require('./platform-warranty-tee');
const { getSecret } = require('./_lib/secrets');

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'admin secret required (?secret=)' }) };

  // 13 of the 15 minutes. The remainder is headroom to finish the in-flight message and
  // return a real summary instead of being cut off mid-write.
  const opts = { days: q.days, subject: q.subject, max: q.max, q: q.q, budgetMs: q.budget_ms || '780000', reparse: q.reparse === '1' };
  let res = { ok: false };
  try { res = await runTee(q.dryrun === '1', opts); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  try { console.log('[warranty-tee-background]', JSON.stringify({ scanned: res.scanned, created: res.created, deduped: res.deduped, enriched: res.enriched, fields_filled: res.fields_filled, stopped_on_budget: res.stopped_on_budget, remaining: res.remaining })); } catch (_) {}
  return { statusCode: 200, body: JSON.stringify(res) };
};
