// DIAG 2026-05-07 - REMOVE after HCP payload investigation.
// One-shot diagnostic that calls HCP API directly to inspect what shape
// HCP itself returns for jobs. Helps decide whether webhook payloads are
// sparse because HCP itself is sparse (the bigger problem) or because
// only the webhook stream is sparse and the API still returns full data
// (poll-on-receive is then viable).
//
// Auth: X-Internal-Auth header must equal $HCP_INTERNAL_AUTH_SECRET.

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Internal-Auth',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const internalAuth = process.env.HCP_INTERNAL_AUTH_SECRET;
  const apiKey = process.env.HCP_API_KEY;
  const baseUrl = process.env.HCP_BASE_URL || 'https://api.housecallpro.com';

  if (!internalAuth || !apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'env not configured', has_auth: !!internalAuth, has_key: !!apiKey }),
    };
  }

  const provided = event.headers['x-internal-auth'] || event.headers['X-Internal-Auth'] || '';
  if (provided !== internalAuth) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'unauthorized' }),
    };
  }

  const url = `${baseUrl}/jobs?per_page=5&sort=created_at&direction=desc`;
  let resp, text, status;
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Accept': 'application/json',
      },
    });
    status = resp.status;
    text = await resp.text();
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'fetch failed', message: err.message }),
    };
  }

  let parsed = null;
  let parseErr = null;
  try { parsed = JSON.parse(text); } catch (e) { parseErr = e.message; }

  // Build a safe summary that shows the shape without leaking PII at scale.
  const summary = {
    hcp_status: status,
    hcp_url: url,
    parse_error: parseErr,
    response_size_bytes: text ? text.length : 0,
    top_level_keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : null,
    is_array: Array.isArray(parsed),
    array_length: Array.isArray(parsed) ? parsed.length : null,
    nested_jobs_array_length: parsed && Array.isArray(parsed.jobs) ? parsed.jobs.length : null,
    raw_first_2000_chars: (text || '').slice(0, 2000),
  };

  if (parsed && typeof parsed === 'object') {
    let firstJob = null;
    if (Array.isArray(parsed) && parsed.length > 0) firstJob = parsed[0];
    else if (Array.isArray(parsed.jobs) && parsed.jobs.length > 0) firstJob = parsed.jobs[0];
    else if (Array.isArray(parsed.data) && parsed.data.length > 0) firstJob = parsed.data[0];
    if (firstJob && typeof firstJob === 'object') {
      summary.first_job_keys = Object.keys(firstJob);
      summary.first_job_id = firstJob.id;
      summary.first_job_has_customer = !!firstJob.customer;
      summary.first_job_has_address = !!firstJob.address;
      summary.first_job_has_assigned_employees = !!firstJob.assigned_employees;
      summary.first_job_tags = firstJob.tags;
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summary),
  };
};
