// track-lead — stamp a created job with WHERE it came from (the page + channel the
// customer first landed on), so the office can see which pages/channels actually
// produce jobs and double down on what works. Fired by the intake at job creation.
//   POST { job_id, conv_id?, landing?, ref?, channel?, utm_source?, utm_campaign?,
//          appliance?, town?, payer? }  -> { ok }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
function s(v, m) { return String(v == null ? '' : v).slice(0, m || 200); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  const meta = {
    job_id: jobId,
    conv_id: s(b.conv_id, 40),
    landing: s(b.landing, 200) || '(unknown)',
    ref: s(b.ref, 300),
    channel: s(b.channel, 60) || 'direct',
    utm_source: s(b.utm_source, 80),
    utm_campaign: s(b.utm_campaign, 120),
    appliance: s(b.appliance, 40),
    town: s(b.town, 80),
    payer: s(b.payer, 40),
    at_ms: Date.now(),
  };
  try { await crud.logEvent('lead_attribution', meta); } catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }
  return j(200, { ok: true, job_id: jobId, landing: meta.landing, channel: meta.channel });
};
