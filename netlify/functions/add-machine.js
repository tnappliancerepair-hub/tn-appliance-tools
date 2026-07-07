// add-machine — the TECH-initiated "＋ Add machine" on the job tile. A stop often has
// more than one appliance (AHS multi-item claims — a dishwasher AND a stove on one
// dispatch). Each machine needs its OWN TDR so Danielle can submit each; the whole app
// is already per-job, so the cleanest path is: each machine = its own job, LINKED to the
// stop, and the tile shows a machine switcher.
//
// This CLONES the parent job (same customer / address / claim / warranty / tech / day)
// via a raw metadata insert — SIDE-EFFECT-FREE (no create_job_from_chat, so NO customer
// greeting SMS fires while the tech is standing in the kitchen) — sets the new appliance,
// and logs a `stop_machine` link so get-stop-machines can group them.
//
//   POST { parent_job_id, appliance_type, brand?, model?, problem?, added_by? }
//     -> { ok, machine_job_id, stop_id }

'use strict';
const crud = require('./_lib/xano/metadata-crud');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

// Only fields we know a machine should INHERIT from the stop. Copied when present on the
// parent row — everything else (id, timestamps, the appliance itself, the TDR) is fresh.
const CLONE_KEYS = [
  'customer_id', 'bill_to_customer_id',
  'service_address', 'service_city', 'service_state', 'service_zip', 'zip',
  'technician_id', 'scheduled_start', 'scheduling_status', 'current_status',
  'warranty_company', 'claim_number', 'customer_type', 'dispatch_source_id',
  'customer_preference_text', 'access_notes', 'sms_consent', 'region', 'market',
  'office_stage', 'parts_eta_date', 'parts_status',
];

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const parentId = parseInt(String(b.parent_job_id || '').replace(/\D/g, ''), 10);
  const appliance = String(b.appliance_type || '').trim();
  if (!parentId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'parent_job_id required' }) };
  if (!appliance) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'appliance_type required' }) };

  // 1) read the parent job (single-field search on id — safe with the metadata API)
  let parent;
  try { parent = await crud.searchOne(crud.TABLES.jobs, { id: parentId }); }
  catch (e) { return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'parent read failed: ' + ((e && e.message) || e) }) }; }
  if (!parent) return { statusCode: 404, headers: CORS, body: JSON.stringify({ ok: false, error: 'parent job not found' }) };

  // The stop_id is the ORIGINAL job of the stop. If the parent is itself an added machine,
  // hang the new machine off the SAME stop (so all siblings share one stop_id).
  let stopId = parentId;
  try {
    const links = await crud.searchPage(crud.TABLES.event_log, { action: 'stop_machine' }, { id: 'desc' }, 300);
    const asChild = (links || []).find((r) => r && r.metadata && Number(r.metadata.machine_job_id) === parentId);
    if (asChild && asChild.metadata && Number(asChild.metadata.stop_id) > 0) stopId = Number(asChild.metadata.stop_id);
  } catch (_) { /* fall back to parentId */ }

  // 2) clone the inheritable fields + set the new machine
  const row = {};
  for (const k of CLONE_KEYS) if (parent[k] !== undefined && parent[k] !== null) row[k] = parent[k];
  row.appliance_type = appliance;
  row.brand = String(b.brand || '').trim() || '';
  row.model_number = String(b.model || '').trim() || '';
  row.problem_summary = String(b.problem || '').trim() || (appliance + ' — added at the stop');
  row.channel = 'tech_add_machine';

  let newId = null;
  try {
    const created = await crud.insert(crud.TABLES.jobs, row);
    newId = (created && (created.id || created.job_id)) || null;
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'insert failed: ' + ((e && e.message) || e) }) };
  }
  if (!newId) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'machine job not created' }) };

  // 3) LINK it to the stop
  await crud.logEvent('stop_machine', {
    stop_id: stopId,
    machine_job_id: newId,
    appliance,
    brand: row.brand,
    added_by: String(b.added_by || 'tech'),
    at_ms: Date.now(),
  });

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, machine_job_id: newId, stop_id: stopId }) };
};
