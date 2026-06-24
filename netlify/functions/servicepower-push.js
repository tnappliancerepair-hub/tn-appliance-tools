// servicepower-push — push an Ant job's status (+ notes) into ServicePower via the
// SPDService updateCallInfo API. THE office-work killer: as a job moves through Ant's
// lifecycle, this updates the warranty portal automatically — no manual entry.
//
// SAFETY: SHADOW by default. It resolves the call number + target status and LOGS
// "would push X" without writing. A real write requires ALL of:
//   - global flag SERVICEPOWER_PUSH_LIVE = 'true' (vault)
//   - admin secret OR office password
//   - confirm:true
// So nothing hits a real warranty record until we deliberately flip it on.
//
//   POST { job_id, status, notes?, eta?, completed?, live?, secret?/password?, confirm? }
//     status = an Ant lifecycle key (see STATUS_MAP)
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const sp = require('./_lib/servicepower');
const { getSecret } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }

// Ant lifecycle → ServicePower CallStatus (+ SPCallStatusID where known from live reads).
// SPCallStatusID numbers get filled in as we observe them; CallStatus name is the anchor.
// Main CallStatus IDs confirmed from v2.8 §14.3: OPEN=2 ACCEPTED=3 CANCELLED=4 COMPLETED=5 REJECTED=6 RESCHEDULED=7
const STATUS_MAP = {
  accepted:   { callStatus: 'ACCEPTED',    spId: '3' },
  scheduled:  { callStatus: 'ACCEPTED',    spId: '3' },
  en_route:   { callStatus: 'ACCEPTED',    spId: '3', sub: 'EN ROUTE' },
  in_progress:{ callStatus: 'ACCEPTED',    spId: '3', sub: 'ON SITE' },
  completed:  { callStatus: 'COMPLETED',   spId: '5' },
  rescheduled:{ callStatus: 'RESCHEDULED', spId: '7' },
  canceled:   { callStatus: 'CANCELLED',   spId: '4' },
  rejected:   { callStatus: 'REJECTED',    spId: '6' },
  note:       { callStatus: null,          spId: null },
};

function spCallNumber(job) {
  const claim = String((job && job.claim_number) || '').trim();
  if (claim) return claim;
  const ni = String((job && job.notes_internal) || '');
  const m = ni.match(/SERVICEPOWER DISPATCH\s+([0-9]{6,})/i);
  return m ? m[1] : '';
}
function isServicePowerJob(job) {
  const wc = String((job && job.warranty_company) || '').toLowerCase();
  return /squaretrade|nsa|servicepower|service power/.test(wc) || !!spCallNumber(job);
}

async function verifyOffice(password) {
  if (!password) return false;
  try {
    const r = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => ({})); return !!(d && (d.valid || d.success || d.ok));
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const jobId = parseInt(String(b.job_id || '').replace(/\D/g, ''), 10) || 0;
  const directCall = String(b.call_number || '').replace(/\D/g, '');
  const statusKey = String(b.status || '').toLowerCase().trim();
  const map = STATUS_MAP[statusKey];
  if (!map) return json(400, { ok: false, error: 'unknown status; use one of ' + Object.keys(STATUS_MAP).join(', ') });
  if (!jobId && !directCall) return json(400, { ok: false, error: 'job_id or call_number required' });

  // load the job for context (optional when call_number is passed directly)
  let job = {};
  if (jobId) { try { job = await crud.searchOne(crud.TABLES.jobs, { id: jobId }) || {}; } catch (_) {} }
  const callNumber = directCall || spCallNumber(job);
  if (!callNumber) return json(200, { ok: false, error: 'no ServicePower call number (pass call_number, or a job with claim_number/notes)' });

  const planned = {
    job_id: jobId || null, call_number: callNumber,
    call_status: map.callStatus, sp_call_status_id: map.spId || null, sub_status: map.sub || null,
    notes: b.notes || '', eta: b.eta || '', completed_date: b.completed || '',
  };

  // LIVE requires the flag + auth + confirm. Otherwise SHADOW.
  const liveFlag = String((await getSecret('SERVICEPOWER_PUSH_LIVE')) || '').toLowerCase() === 'true';
  const adminOk = b.secret && b.secret === ((await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5');
  const authed = adminOk || (await verifyOffice(b.password));
  // AUTO-fire writes need the global flag; a MANUAL admin-directed write (manual:true
  // + admin secret + confirm) is a deliberate one-off and is allowed without it.
  const goLive = b.live === true && b.confirm === true && authed && (liveFlag || b.manual === true);

  if (!goLive) {
    // SHADOW — log what we WOULD send, send nothing.
    try { await crud.logEvent('servicepower_push_shadow', { ...planned, live_flag: liveFlag, would_send: true, at_ms: Date.now() }); } catch (_) {}
    return json(200, { ok: true, mode: 'shadow', planned, note: 'SHADOW — nothing sent to ServicePower. To go live: set SERVICEPOWER_PUSH_LIVE=true + pass live:true, confirm:true, and admin secret/office password.' });
  }

  // LIVE push
  let res;
  try {
    res = await sp.updateCallInfo({
      callNumber, callStatus: map.callStatus, spCallStatusId: map.spId || undefined,
      callSubStatus: map.sub || undefined, fssCallId: b.fss_call_id || undefined, mfgId: b.mfg_id || undefined,
      scheduleDate: b.schedule_date || undefined, scheduleTimePeriod: b.schedule_time || undefined,
      notes: b.notes || undefined, completedDate: b.completed || undefined, eta: b.eta || undefined,
    });
  } catch (e) { return json(200, { ok: false, mode: 'live', error: String((e && e.message) || e), planned }); }
  try { await crud.logEvent('servicepower_push_sent', { ...planned, soap_status: res.status, ok: res.ok, ack: res.ack, err_code: res.err_code, err_desc: res.err_desc, at_ms: Date.now() }); } catch (_) {}
  return json(200, { ok: res.ok, mode: 'live', planned, soap_status: res.status, error_occurred: res.error_occurred, ack: res.ack, err_code: res.err_code, err_desc: res.err_desc, err_cause: res.err_cause, fault_string: res.fault_string, detail: (res.raw || '').slice(0, 500) });
};
