// admin-tech — TEMP guarded helper to read/edit a technician row from the cloud
// (the XS update_technician doesn't do phone, and XS pushes need the Mac).
// Guarded by a shared secret. Uses XANO_METADATA_TOKEN (in Netlify env).
//
//   GET ?secret=<G>&action=get&id=3
//   GET ?secret=<G>&action=setphone&id=3&phone=5049099413

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const TECH_TABLE = 15;
const JOBS_TABLE = 7;
const GUARD = 'tn-admin-tech-7b3e1f';

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.secret !== GUARD) return { statusCode: 403, body: 'forbidden' };
  const id = Number(q.id || 0);
  if (!id) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'id required' }) };

  try {
    if (q.action === 'get') {
      const r = await fetch(`${META}/table/${TECH_TABLE}/content/${id}`, { headers: headers() });
      const j = await r.json().catch(() => ({}));
      return { statusCode: 200, body: JSON.stringify({ ok: r.ok, tech: { id: j.id, first_name: j.first_name, last_name: j.last_name, phone: j.phone, active: j.active } }) };
    }
    if (q.action === 'setphone') {
      const phone = String(q.phone || '').trim();
      if (!phone) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'phone required' }) };
      const r = await fetch(`${META}/table/${TECH_TABLE}/content/${id}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ phone }) });
      const j = await r.json().catch(() => ({}));
      return { statusCode: 200, body: JSON.stringify({ ok: r.ok, status: r.status, tech: { id: j.id, first_name: j.first_name, phone: j.phone } }) };
    }
    // Take a job off the calendar without canceling it: clear scheduled_start
    // (+ tech) so it falls out of the week grid and back toward needs-scheduled.
    if (q.action === 'cleardate') {
      const r = await fetch(`${META}/table/${JOBS_TABLE}/content/${id}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ scheduled_start: null }) });
      const j = await r.json().catch(() => ({}));
      return { statusCode: 200, body: JSON.stringify({ ok: r.ok, status: r.status, job: { id: j.id, scheduled_start: j.scheduled_start, scheduling_status: j.scheduling_status } }) };
    }
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'unknown action' }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
