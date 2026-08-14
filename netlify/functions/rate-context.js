// rate-context — resolves a review-rating link (rate.html?j=<job>&t=<token>) into the
// customer's first name + tech + appliance so the rating page can greet them. Token is an
// HMAC of the job id (shareable, not guessable — same pattern as pay-owed/pay.html).
//
//   GET ?j=<job_id>&t=<token>  ->  { ok, first, tech, appliance, google_url, already, stars }
'use strict';
const crypto = require('crypto');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const REVIEW_URL = 'https://g.page/r/CRt-vo--eAJ3EBM/review';

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function tokenSecret() { return (await getSecret('PAY_LINK_SECRET')) || (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5'; }
async function rateToken(jobId) { return crypto.createHmac('sha256', await tokenSecret()).update('rate:' + jobId).digest('hex').slice(0, 12); }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const jobId = Number(q.j || 0);
  const tok = String(q.t || '');
  if (!jobId || !tok) return j(400, { ok: false, error: 'missing j/t' });
  if (tok !== (await rateToken(jobId))) return j(401, { ok: false, error: 'bad token' });

  // has this job already been rated? (one rating per job)
  let already = false, priorStars = 0;
  try {
    const row = await crud.searchOne(crud.TABLES.event_log, { action: 'review_star_' + jobId }, { id: 'desc' });
    if (row) { already = true; priorStars = Number(meta(row).stars || 0); }
  } catch (_) {}

  let first = 'there', tech = '', appliance = '';
  try {
    const d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(9000) }).then((r) => r.json());
    const c = (d && d.customer) || {};
    first = String(c.first_name || 'there').trim() || 'there';
    const tk = (d && d.tech) || {};
    tech = String((tk && (tk.first_name || tk.name)) || '').trim().split(/\s+/)[0] || '';
    const ap = (d && d.appliance) || {};
    appliance = String((ap && ap.type) || (d && d.job && d.job.appliance_type) || '').trim().toLowerCase();
  } catch (_) {}

  return j(200, { ok: true, first, tech, appliance, google_url: REVIEW_URL, already, stars: priorStars });
};
