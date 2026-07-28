// mark-return-shipped — the "✓ shipped it" tap. Records that a return label was
// printed + the box handed to FedEx, so it drops off the OWED list immediately
// (interim status until the weekly Allstate report confirms returned=1). This is
// also the timestamped chargeback proof that we sent it.
//   POST { secret, claim, part, rma?, tracking?, distributor?, job_id?, by? }
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  // Admin secret (return-finder) OR a tech context (the tech app marks his own
  // return shipped from the field — it carries a job_id, not the admin secret).
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (b.secret !== admin && !Number(b.job_id)) return json(401, { ok: false, error: 'unauthorized' });
  const claim = String(b.claim || '').replace(/[^0-9]/g, '');
  const part = String(b.part || '').trim();
  if (!claim && !part) return json(400, { ok: false, error: 'claim or part required' });
  const undo = b.undo === true || b.undo === 'true';
  try {
    await crud.logEvent('warranty_part_status', {
      status: undo ? 'reopened' : 'shipped',
      claim, part, rma: b.rma || '', tracking: b.tracking || '',
      distributor: b.distributor || '', job_id: b.job_id || null,
      by: b.by || 'return-finder', at_ms: Date.now(),
    });
    return json(200, { ok: true, claim, part, status: undo ? 'reopened' : 'shipped' });
  } catch (e) { return json(200, { ok: false, error: 'log failed: ' + String((e && e.message) || e) }); }
};
