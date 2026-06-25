// waiver-stats — release-of-liability signing rate. Of the jobs we SENT a waiver
// for, how many got SIGNED? Answers "how many people actually sign it."
//   GET ?secret=<admin>&days=30
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const EVENT_LOG = 3;
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// Most-recent event_log rows for an action, filtered to newer than `sinceMs`.
async function rowsSince(action, sinceMs) {
  let items = [];
  try { items = await crud.searchPage(EVENT_LOG, { action }, { created_at: 'desc' }, 500); } catch (_) { items = []; }
  return items.filter((r) => {
    const t = r.created_at ? Date.parse(r.created_at) : 0;
    return !sinceMs || t >= sinceMs;
  });
}
function jobIdsOf(rows) {
  const s = new Set();
  for (const r of rows) {
    let m = r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    const j = parseInt(m && m.job_id, 10);
    if (j) s.add(j);
  }
  return s;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const days = parseInt(q.days, 10) || 30;
  const since = Date.now() - days * 86400000;

  const [sentRows, signedRows] = await Promise.all([
    rowsSince('waiver_sent', since),
    rowsSince('customer_waiver_signed', 0), // signs can land after the send window
  ]);
  const sentJobs = jobIdsOf(sentRows);
  const signedJobs = jobIdsOf(signedRows);
  let signedOfSent = 0;
  for (const j of sentJobs) if (signedJobs.has(j)) signedOfSent++;
  const rate = sentJobs.size ? Math.round((signedOfSent / sentJobs.size) * 100) : 0;

  return json(200, {
    ok: true, window_days: days,
    waivers_sent_jobs: sentJobs.size,
    waivers_signed_jobs_overall: signedJobs.size,
    signed_of_sent: signedOfSent,
    sign_rate_pct: rate,
    note: 'sign_rate_pct = of jobs we sent a release for in the window, the % that got signed (any time).',
  });
};
