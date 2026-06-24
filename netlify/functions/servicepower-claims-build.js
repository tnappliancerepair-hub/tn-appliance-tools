// servicepower-claims-build — assemble a SQUARE TRADE ServiceClaims SUBMISSION payload
// from a completed job + its TDR, so "finishing the TDR" = "filing the claim."
//
// PREVIEW/SHADOW ONLY — it builds the claim and shows it (+ a STILL-NEEDED list); it does
// NOT submit. The coded fields (defect/repair/category, part fault/job codes) are mapped by
// CODE_MAP, seeded from a real claim (MONAHAN: MECH/REP/Minor on-site) and refined once we
// load SquareTrade's official code lists. Live submit is a separate gated step.
//
//   GET ?secret=<admin>&job_id=<id>        build claim for a job
//   GET ?secret=<admin>&call=<dispatch#>   build claim by dispatch/call number
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const { getSecret, getSecretFresh } = require('./_lib/secrets');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// SquareTrade coded fields — SEEDED from real claims; refine arrays once we load the
// official Defect / Repair / Category code lists from the portal. Ant maps the tech's
// plain-language TDR → these codes (the tech never types a code).
const CODE_MAP = {
  // defect/complaint → eiaDefectOrComplaintCode  (seed: everything mechanical = MECH)
  defect(text) {
    const s = String(text || '').toLowerCase();
    if (/leak|water|drain|valve|hose|pump/.test(s)) return { code: 'MECH', why: 'water/leak → MECH (seed)' };
    if (/heat|cool|temp|element|compressor|burner|igni/.test(s)) return { code: 'MECH', why: 'thermal → MECH (seed)' };
    if (/board|control|sensor|electric|power|wire/.test(s)) return { code: 'ELEC', why: 'electrical → ELEC (seed)' };
    return { code: 'MECH', why: 'default MECH (seed — confirm w/ code list)' };
  },
  // repair action → eiaRepairCode1  (seed: REP=repaired, REPL=replaced part)
  repair(text) {
    const s = String(text || '').toLowerCase();
    if (/replac|new part|installed/.test(s)) return { code: 'REP', why: 'replaced part → REP (seed)' };
    return { code: 'REP', why: 'default REP (seed — confirm w/ code list)' };
  },
  // repairCategory  (seed: most are minor on-site)
  category() { return { code: 'Minor on-site service', why: 'seed default — confirm w/ category list' }; },
};

function spCallNumber(job) {
  const claim = String((job && job.claim_number) || '').trim();
  if (claim) return claim;
  const ni = String((job && job.notes_internal) || '');
  const m = ni.match(/SERVICEPOWER DISPATCH\s+([0-9]{6,})/i);
  return m ? m[1] : '';
}
function ymdNum(v) { // ms or ISO → CCYYMMDD number
  if (!v) return 0;
  const d = (typeof v === 'number') ? new Date(v) : new Date(String(v));
  if (isNaN(d)) return 0;
  return Number(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);
}
function hmNum(v) { if (!v) return 0; const d = (typeof v === 'number') ? new Date(v) : new Date(String(v)); if (isNaN(d)) return 0; return Number(`${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`); }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  // resolve job_id (direct, or by dispatch/call number)
  let jobId = parseInt(String(q.job_id || '').replace(/\D/g, ''), 10) || 0;
  if (!jobId && q.call) {
    try { const j = await crud.searchOne(crud.TABLES.jobs, { claim_number: String(q.call) }); if (j) jobId = j.id; } catch (_) {}
  }
  if (!jobId) return json(400, { ok: false, error: 'pass job_id or call=<dispatch#> (call lookup matches jobs.claim_number)' });

  // pull job + customer + TDR + failures
  let ctx;
  try { ctx = await fetch(`${XANO}/get_warranty_submission_context?job_id=${jobId}`, { signal: AbortSignal.timeout(12000) }).then((r) => r.json()); }
  catch (e) { return json(200, { ok: false, error: 'context fetch failed: ' + String((e && e.message) || e) }); }
  if (!ctx || ctx.success === false) return json(200, { ok: false, error: (ctx && ctx.error) || 'no context', job_id: jobId });

  const job = ctx.job || {}, cust = ctx.customer || {}, tdr = ctx.tdr || {}, fails = ctx.tdr_failures || [];
  const svcAcct = String(await getSecretFresh('SERVICEPOWER_SVCR_ACCT') || 'TNA00001').trim();
  const callNo = spCallNumber(job);

  const complaint = job.problem_summary || tdr.diagnosis || '';
  const performed = tdr.repair_completed || tdr.diagnosis || '';
  const defect = CODE_MAP.defect(`${complaint} ${tdr.failed_component || ''}`);
  const repair = CODE_MAP.repair(performed);
  const cat = CODE_MAP.category();

  const parts = (fails || []).map((f) => ({
    number: f.oem_part_number || f.verified_part_number || f.part_number || '',
    quantity: Number(f.quantity || 1),
    description: f.failed_component || f.part_name || '',
    priceRequested: Number((f.our_cost_cents != null ? f.our_cost_cents / 100 : f.cost) || 0),
    faultCode: '',  // ← Ant maps from failure once we have the fault-code list
    jobCode: '',    // ← Ant maps from repair once we have the job-code list
    returned: 'N',
  })).filter((p) => p.number || p.description);

  const laborHours = Number(tdr.labor_time_hours || 0);
  // SquareTrade labor rate: $150 first/only trip, $105 each additional (return) trip.
  // tripNum from ?trip= override, else a job trip/visit field, else 1.
  const tripNum = Number(q.trip || job.trip_count || job.visit_number || job.trip_number || 1) || 1;
  const laborAmount = tripNum > 1 ? 105 : 150;

  const claim = {
    manufacturerName: 'SQUARE TRADE',
    serviceCenterNumber: svcAcct,
    claimNumber: callNo,
    callNumber: callNo,
    customerFirstName: cust.first_name || '', customerLastName: cust.last_name || '',
    customerAddress1: cust.address_line1 || cust.address || '', customerAddress2: cust.address_line2 || '',
    customerCity: cust.city || '', customerState: cust.state || '', customerZipCode: cust.zip || cust.zip_code || '',
    customerCountryCode: 'USA', customerPhone: String(cust.phone || '').replace(/\D/g, ''), customerEmail: cust.email || '',
    brandName: job.brand || '', modelNumber: job.model_number || tdr.model_number || '', serialNumber: job.serial_number || tdr.serial_number || '',
    datePurchased: ymdNum(job.purchase_date),
    eiaDefectOrComplaintCode: defect.code, defectOrComplaintDescription: complaint,
    servicePerformedDescription: performed,
    eiaRepairCode1: repair.code, repairCategory: cat.code,
    dateStarted: ymdNum(job.job_started_at || job.scheduled_start), timeStarted: hmNum(job.job_started_at),
    dateCompleted: ymdNum(job.job_completed_at), timeCompleted: hmNum(job.job_completed_at),
    totalRepairMinutes: Math.round(laborHours * 60), serviceHours: laborHours,
    tripCount: tripNum,
    laborAmount,   // $150 first/only trip, $105 each additional
    partsAmount: parts.reduce((a, p) => a + Number(p.priceRequested || 0), 0),
    authorizationNumber: job.authorization_number || '',
    serviceContractNumber: job.service_contract_number || '',
    warrantyType: 1,
    parts,
  };

  // what's still missing for a clean submit
  const needed = [];
  if (!claim.callNumber) needed.push('dispatch/call number (job has no claim_number/notes)');
  if (!claim.customerFirstName && !claim.customerLastName) needed.push('customer name');
  if (!claim.customerAddress1) needed.push('customer address');
  if (!claim.brandName) needed.push('brand');
  if (!claim.modelNumber) needed.push('model number');
  if (!claim.dateCompleted) needed.push('job_completed_at (mark the job complete first)');
  if (!performed) needed.push('service performed (TDR repair_completed)');
  needed.push('⭐ PARTS USED-vs-RETURN: each part needs returned Y/N (the SquareTrade biggie) — surface the picked parts in the TDR so the tech marks USED or RETURN');
  needed.push('OFFICIAL CODE LISTS → confirm defect/repair/category + part fault/job codes (currently seeded)');

  return json(200, {
    ok: true, mode: 'preview-shadow', job_id: jobId,
    code_mapping: { defect, repair, category: cat, note: 'seeded — refine CODE_MAP with the portal code lists' },
    still_needed: needed,
    claim,
    submission_endpoint: 'https://claimworks.servicepower.com:8443/services/claim/v1/submission  (JSON, same auth — confirm + build submit fn next)',
  });
};
