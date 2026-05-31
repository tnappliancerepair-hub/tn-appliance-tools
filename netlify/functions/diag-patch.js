// Diagnostic: try PATCHing a single job row via Xano metadata API and report
// full request/response. Used to debug practice-mode 404s.
// Usage: GET /.netlify/functions/diag-patch?job_id=18278&op=patch_minimal

const META_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';

exports.handler = async function (event) {
  const qp = event.queryStringParameters || {};
  const jobId = parseInt(qp.job_id || '0', 10);
  const op = qp.op || 'patch_minimal';

  if (!jobId) return jr(400, { ok: false, error: 'job_id required' });
  if (!process.env.XANO_METADATA_TOKEN) {
    return jr(500, { ok: false, error: 'XANO_METADATA_TOKEN missing' });
  }

  const url = `${META_BASE}/table/7/content/${jobId}`;
  const headers = {
    Authorization: `Bearer ${process.env.XANO_METADATA_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const results = {};

  // Test 1: GET the row
  try {
    const r = await fetch(url, { headers });
    results.get = { status: r.status, body: (await r.text()).slice(0, 300) };
  } catch (e) {
    results.get = { err: String(e.message || e) };
  }

  // Test 2: PATCH minimal (just one field)
  if (op === 'patch_minimal' || op === 'all') {
    try {
      const r = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ scheduled_end: 1780372800000 }),
      });
      results.patch_minimal = { status: r.status, body: (await r.text()).slice(0, 300) };
    } catch (e) {
      results.patch_minimal = { err: String(e.message || e) };
    }
  }

  // Test 3: PUT minimal
  if (op === 'put_minimal' || op === 'all') {
    try {
      const r = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ scheduled_end: 1780372800000 }),
      });
      results.put_minimal = { status: r.status, body: (await r.text()).slice(0, 300) };
    } catch (e) {
      results.put_minimal = { err: String(e.message || e) };
    }
  }

  return jr(200, { url, jobId, results });
};

function jr(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, null, 2),
  };
}
