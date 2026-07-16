// split-multi-appliance-job — split ONE multi-item job (e.g. "dryer/washer") into separate
// linked appliance jobs so each shows as its own stop on the tech's day + gets its own TDR.
// DRY-RUN by default (returns the plan, writes nothing); pass the admin secret to run it live.
//
//   GET/POST ?job_id=<id>[&secret=<admin>]
//     no secret  -> dry run (plan only)
//     &secret=   -> live: relabels the parent to the 1st appliance + creates the sibling jobs
'use strict';
const { splitJob } = require('./_lib/appliance-split');
const { getSecret } = require('./_lib/secrets');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = q.job_id || body.job_id;
  const secret = q.secret || body.secret || '';
  if (!jobId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'job_id required' }) };

  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const live = secret === admin;

  const res = await splitJob(jobId, { live });
  if (!live && res && res.split) res.note = 'DRY RUN — pass &secret= to create these jobs';
  return { statusCode: 200, headers: CORS, body: JSON.stringify(res, null, 2) };
};
