// add-appliance-job — creates a linked SIBLING job for a 2nd (3rd…) appliance on the
// same warranty claim. AHS/Frontdoor dispatches can cover multiple items on ONE claim;
// our intake only captures one, so the extras get dropped (Danielle, 2026-06-22 — Sara
// V.'s washer + dishwasher). This lets the office add the missing appliance in one tap:
// same customer, same claim #, same address — a new job that schedules + bills on its own.
//
//   POST { source_job_id?, phone, first_name, last_name, zip, address, city, state,
//          appliance_type, brand, problem, warranty_company, claim_number }
//     -> { ok, new_job_id }

'use strict';

const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const appliance = String(b.appliance_type || '').trim();
  const phone = String(b.phone || '').replace(/[^\d+]/g, '');
  if (!appliance) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'appliance_type required' }) };
  if (!phone && !b.first_name) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'need phone or name to match the customer' }) };

  const claim = String(b.claim_number || '').trim();
  const problem = (claim ? ('Claim ' + claim + ' — additional item on this dispatch. ') : '') + String(b.problem || '').trim();

  // 1) create the sibling job — create_job_from_chat matches the existing customer by
  // phone (no duplicate customer) and drops the job into Needs-Scheduled.
  let newId = null;
  try {
    const r = await fetch(`${XANO}/create_job_from_chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: b.first_name || 'Customer',
        last_name: b.last_name || '',
        phone, zip: b.zip || '',
        appliance_type: appliance,
        brand: b.brand || '',
        problem_summary: problem,
        customer_type: 'warranty',
        channel: 'office_add_appliance',
      }),
    });
    const d = await r.json().catch(() => ({}));
    newId = (d && (d.id || d.job_id)) || null;
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'create failed: ' + e.message }) };
  }
  if (!newId) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'job not created' }) };

  // 2) stamp the warranty + address fields create_job_from_chat doesn't take, so the
  // sibling is a complete warranty job (links to the claim, routes by address).
  try {
    await crud.update(crud.TABLES.jobs, newId, {
      warranty_company: b.warranty_company || '',
      claim_number: claim,
      service_address: b.address || '',
      service_city: b.city || '',
      service_state: b.state || '',
      customer_type: 'warranty',
    });
  } catch (_) {}

  try { await crud.logEvent('appliance_added_to_claim', { source_job_id: b.source_job_id || null, new_job_id: newId, claim_number: claim, appliance_type: appliance, brand: b.brand || '', at_ms: Date.now() }); } catch (_) {}

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, new_job_id: newId }) };
};
