// record-gclid — store the Google click id (gclid) for a job, so we can later upload
// an offline conversion ("this ad click became a $X cash job") back to Google Ads.
// Fired by the intake page when a self-pay job is created and a gclid is present.
//   POST { job_id, gclid?, gbraid?, wbraid?, conv_id? }  -> { ok }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
function s(v, m) { return String(v == null ? '' : v).slice(0, m || 200); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const gclid = s(b.gclid, 200), gbraid = s(b.gbraid, 200), wbraid = s(b.wbraid, 200);
  if (!gclid && !gbraid && !wbraid) return j(200, { ok: true, skipped: 'no click id' });
  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  await crud.logEvent('ad_click', { job_id: jobId, conv_id: s(b.conv_id, 40), gclid, gbraid, wbraid, source: 'google_ads', at_ms: Date.now() });
  return j(200, { ok: true, job_id: jobId });
};
