// Diagnostic: GETs rows from a Xano table via metadata API for debugging.
// Usage:
//   GET /.netlify/functions/diag-patch?job_id=18278&op=patch_minimal — original PATCH test
//   GET /.netlify/functions/diag-patch?op=list_tdrs — list recent TDRs (last 20)

const META_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';

exports.handler = async function (event) {
  const qp = event.queryStringParameters || {};
  const jobId = parseInt(qp.job_id || '0', 10);
  const op = qp.op || 'patch_minimal';

  // op=list_tdrs — list recent TDR rows (tdr table is id 12)
  if (op === 'list_tdrs') {
    try {
      const r = await fetch(`${META_BASE}/table/12/content?page=1&per_page=20`, {
        headers: { Authorization: `Bearer ${process.env.XANO_METADATA_TOKEN}` },
      });
      const body = await r.json();
      const items = (body.items || []).slice(-20).map((t) => ({
        id: t.id,
        job_id: t.job_id,
        technician_id: t.technician_id,
        created_at: t.created_at,
        diagnosis: (t.diagnosis || '').slice(0, 60),
        failed_component: t.failed_component,
        labor_time_hours: t.labor_time_hours,
        repair_completed: (t.repair_completed || '').slice(0, 40),
      }));
      return jr(200, { ok: true, count: items.length, items });
    } catch (e) {
      return jr(500, { ok: false, error: String(e.message || e) });
    }
  }

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
