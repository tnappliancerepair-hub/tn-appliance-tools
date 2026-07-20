// merge-customers — consolidate DUPLICATE customer records (the SquareTrade
// update-email bug spawns a new customer per email). Re-points the duplicates'
// JOBS onto one keeper record so a person's whole history lives under one profile.
//
// NEVER deletes a job, never touches status or billing amounts. SquareTrade bills
// a separate work-order per trip, so every job is real + kept — only the customer
// record is unified. Fully reversible (logs the original customer_id per job).
//
//   GET ?secret=<VAPI_ADMIN_SECRET>&keep=<id>&dupes=<id,id>          -> DRY RUN
//   GET ?secret=...&keep=<id>&dupes=<id,id>&apply=1                  -> apply
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');

const CUSTOMER = crud.TABLES.customer; // 6
const JOBS = crud.TABLES.jobs;         // 7

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
function nm(c) { return c ? (((c.first_name || c.customer_first || '') + ' ' + (c.last_name || c.customer_last || '')).trim()) : ''; }
function dig(v) { return String(v || '').replace(/\D/g, ''); }
function jShape(j) { return { job_id: j.id, appliance: j.appliance_type, status: j.scheduling_status, customer_id: j.customer_id, bill_to_customer_id: j.bill_to_customer_id }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });

  const keep = Number(q.keep) || 0;
  const dupes = String(q.dupes || '').split(',').map((x) => Number(x.trim())).filter((n) => n && n !== keep);
  if (!keep || !dupes.length) return json(400, { error: 'need ?keep=<id>&dupes=<id,id>&secret=' });
  const apply = q.apply === '1';

  const keeper = await crud.searchOne(CUSTOMER, { id: keep });
  if (!keeper) return json(404, { error: 'keeper customer not found', keep });
  const kName = nm(keeper).toLowerCase();
  const kPhone = dig(keeper.phone || keeper.phone_number || keeper.mobile);

  // Load each duplicate + its jobs; refuse if a record looks like a DIFFERENT person.
  const groups = [];
  for (const d of dupes) {
    const cust = await crud.searchOne(CUSTOMER, { id: d });
    const jobs = await crud.search(JOBS, { customer_id: d });
    if (cust) {
      const sameName = nm(cust).toLowerCase() === kName;
      const dPhone = dig(cust.phone || cust.phone_number || cust.mobile);
      const samePhone = dPhone && dPhone === kPhone;
      if (!sameName && !samePhone) {
        return json(409, { error: 'name+phone mismatch — refusing to merge what looks like a different person', dupe: d, dupe_name: nm(cust), dupe_phone: dPhone, keeper_name: nm(keeper), keeper_phone: kPhone });
      }
    }
    groups.push({ dupe_id: d, dupe_name: cust ? nm(cust) : '(not found)', jobs: jobs.map(jShape) });
  }

  const keeperJobs = await crud.search(JOBS, { customer_id: keep });
  const movingCount = groups.reduce((n, g) => n + g.jobs.length, 0);

  if (!apply) {
    return json(200, {
      dry_run: true,
      keeper: { id: keep, name: nm(keeper), phone: kPhone, current_jobs: keeperJobs.map(jShape) },
      will_move: groups,
      after: { one_customer: keep, total_jobs: keeperJobs.length + movingCount },
      note: 'DRY RUN — nothing changed. Add &apply=1 to move these jobs onto the keeper. Jobs are NEVER deleted; status + billing amounts untouched. Reversible via the customer_merge_job_repointed logs.',
    });
  }

  const moved = [];
  for (const g of groups) {
    for (const j of g.jobs) {
      const patch = { customer_id: keep };
      // Only re-point bill_to if it currently points at a duplicate (never clobber PM billing).
      if (dupes.includes(Number(j.bill_to_customer_id))) patch.bill_to_customer_id = keep;
      try {
        await crud.update(JOBS, j.job_id, patch);
        await crud.logEvent('customer_merge_job_repointed', { job_id: j.job_id, from_customer: g.dupe_id, to_customer: keep, orig_customer_id: j.customer_id, orig_bill_to: j.bill_to_customer_id, appliance: j.appliance, at_ms: Date.now() });
        moved.push({ job_id: j.job_id, from: g.dupe_id, to: keep });
      } catch (e) { moved.push({ job_id: j.job_id, error: String((e && e.message) || e) }); }
    }
  }
  await crud.logEvent('customer_merge_applied', { keep, dupes, moved: moved.filter((m) => !m.error).length, at_ms: Date.now() });
  return json(200, { applied: true, keep, moved, note: 'Jobs re-pointed to the keeper. Nothing deleted. Reverse via customer_merge_job_repointed logs.' });
};
