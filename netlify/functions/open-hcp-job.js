// open-hcp-job — tap-to-work. A tech taps a stop on their dashboard; this imports
// THAT one job into Ant via import_hcp_job (idempotent on the HCP job id, so
// re-tapping never duplicates) and returns the Ant job_id so the dashboard opens
// the tech work page. On-demand only — no mass sync, no all-day hook.
'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

function j(code, body) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'invalid_json' }); }

  const hcpId = String(b.hcp_id || '').trim();
  if (!hcpId) return j(400, { ok: false, error: 'hcp_id required' });

  const payload = {
    hcp_job_id: hcpId,
    hcp_job_number: b.hcp_job_number || '',
    work_status: b.work_status || '',
    customer_first_name: b.first_name || '',
    customer_last_name: b.last_name || '',
    customer_phone: b.phone || '',
    customer_email: b.email || '',
    service_address: b.street || '',
    service_city: b.city || '',
    service_state: b.state || '',
    service_zip: b.zip || '',
    scheduled_start_ms: b.scheduled_start_ms || null,
    scheduled_end_ms: b.scheduled_end_ms || null,
    technician_id: b.technician_id ? Number(b.technician_id) : null,
    description: b.description || '',
  };

  try {
    const r = await fetch(`${XANO}/import_hcp_job`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!d || !d.success || !d.job_id) return j(200, { ok: false, error: (d && d.error) || 'import_failed', detail: JSON.stringify(d).slice(0, 200) });
    return j(200, { ok: true, job_id: d.job_id });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
