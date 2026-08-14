// rate-submit — records a star rating tapped on rate.html.
//   • 4-5★  -> log it; the page redirects the customer to Google to post publicly.
//   • 1-3★  -> log it + capture the private feedback + text Teddy so a human makes it
//             right (the "gate" — unhappy customers go to us, not to a public 1-star).
// One rating per job (idempotent). Token = HMAC of the job id (same as rate-context).
//
//   POST { j, t, stars, feedback? }  ->  { ok, outcome:'google'|'private'|'already', google_url }
'use strict';
const crypto = require('crypto');
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const REVIEW_URL = 'https://g.page/r/CRt-vo--eAJ3EBM/review';
const OWNER = '+16154855795';

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
async function tokenSecret() { return (await getSecret('PAY_LINK_SECRET')) || (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5'; }
async function rateToken(jobId) { return crypto.createHmac('sha256', await tokenSecret()).update('rate:' + jobId).digest('hex').slice(0, 12); }
async function textOwner(msg) { try { await fetch(`${XANO}/send_sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: OWNER, message: msg, force_send: true, context_tag: 'review_low_star' }), signal: AbortSignal.timeout(9000) }); } catch (_) {} }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'POST only' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'bad json' }); }
  const jobId = Number(b.j || 0);
  const tok = String(b.t || '');
  const stars = Math.max(0, Math.min(5, parseInt(b.stars, 10) || 0));
  const feedback = String(b.feedback || '').slice(0, 800);
  if (!jobId || !tok || !stars) return j(400, { ok: false, error: 'missing j/t/stars' });
  if (tok !== (await rateToken(jobId))) return j(401, { ok: false, error: 'bad token' });

  // resolve customer for the log + owner alert (best-effort)
  let first = 'a customer', custId = 0, phone = '';
  try {
    const d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(9000) }).then((r) => r.json());
    const c = (d && d.customer) || {};
    first = String(c.first_name || 'a customer').trim() || 'a customer';
    custId = Number(c.id || 0); phone = String(c.phone || '');
  } catch (_) {}

  // idempotent: if this job already recorded a rating, don't double-log / double-alert.
  let already = null;
  try { already = await crud.searchOne(crud.TABLES.event_log, { action: 'review_star_' + jobId }, { id: 'desc' }); } catch (_) {}

  const positive = stars >= 4;
  const outcome = positive ? 'google' : 'private';

  if (!already) {
    // per-job marker (dedup) + a countable funnel row for the scorecard
    try { await crud.logEvent('review_star_' + jobId, { stars, outcome, cust_id: custId, job_id: jobId, at_ms: Date.now() }); } catch (_) {}
    try { await crud.logEvent('review_star', { stars, outcome, cust_id: custId, job_id: jobId, at_ms: Date.now() }); } catch (_) {}
    if (positive) {
      // mark the 60-day per-customer "asked/handled" so no other path re-nags a happy rater
      if (custId) { try { await crud.logEvent('google_review_asked_customer_' + custId, { job_id: jobId, via: 'rate_page', source: 'star_' + stars, at_ms: Date.now() }); } catch (_) {} }
    } else {
      // low star: alert Teddy so a human can save it before it can ever become public
      const fb = feedback ? `\n"${feedback}"` : ' (no comment left)';
      await textOwner(`⭐ ${stars}-star from ${first}${custId ? '' : ''} · job #${jobId}${phone ? ' · ' + phone : ''}:${fb}\n\nThey went to the private form, NOT Google. Consider a personal call to make it right. - Ant 🐜`);
    }
  } else if (feedback && Number(meta(already).stars || 0) <= 3) {
    // low-star follow-up: they came back and left a comment after the initial tap — forward it
    await textOwner(`⭐ Follow-up comment from ${first} · job #${jobId}:\n"${feedback}"\n- Ant 🐜`);
  }

  return j(200, { ok: true, outcome: already ? 'already' : outcome, google_url: REVIEW_URL, first });
};
