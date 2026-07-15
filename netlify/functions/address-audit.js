// address-audit — proves the service address + customer info on each job is trustworthy,
// so the techs + office can BELIEVE the tile (Andre + Jimmy + Danielle 2026-07-15: they do
// not trust the address). It resolves each active job's address the same way the tech app
// does (job.service_address, else the customer record) and flags every job whose address
// is not clean: no street, a NUMBER-ONLY street (the AHS "1 Nashville" parser bug), no
// city, a bad zip, no phone, or a job-vs-customer address that disagree.
//
//   GET ?secret=<admin>   ->  { ok, active, clean, flagged, by_reason, jobs:[{id,name,reasons,...}] }
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const JOBS = crud.TABLES.jobs;         // 7
const CUSTOMER = crud.TABLES.customer; // 6
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
const s = (v) => String(v == null ? '' : v).trim();
const digits = (v) => s(v).replace(/\D/g, '');
// A real street has a NAME, not just a number. Strip a leading house number and require
// letters to remain -> "1" fails (the AHS bug), "2717 ASCENSION CT" passes.
function hasStreetName(street) { const t = s(street); if (!t) return false; return /[a-z]{2,}/i.test(t.replace(/^\s*\d+[a-z]?\s*/i, '')); }
// The board feed loads these; a job in any other non-terminal status is still real work.
const ACTIVE = new Set(['not_ready', 'needs_scheduled', 'scheduled', 'in_progress', 'awaiting_parts', 'held', 'needs_more_info', 'broadcasting', 'booked']);

// All-rows page (content/search with NO `search` key -> everything; an empty {} filter 400s).
async function listPage(tableId, perPage, page) {
  const r = await fetch(`${META}/table/${tableId}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: perPage, page: page || 1, sort: { id: 'desc' } }) });
  if (!r.ok) throw new Error(`list ${tableId} p${page} -> ${r.status}`);
  return ((await r.json()).items) || [];
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const custById = {};
  try { for (let pg = 1; pg <= 6; pg++) { const rows = await listPage(CUSTOMER, 500, pg); rows.forEach((c) => { custById[c.id] = c; }); if (rows.length < 500) break; } } catch (_) {}

  let jobs = [];
  try { for (let pg = 1; pg <= 8; pg++) { const rows = await listPage(JOBS, 400, pg); jobs = jobs.concat(rows); if (rows.length < 400) break; } }
  catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }

  const flagged = []; const byReason = {}; let active = 0, clean = 0;
  for (const j of jobs) {
    const ss = s(j.scheduling_status).toLowerCase(), cs = s(j.current_status).toLowerCase();
    if (!ACTIVE.has(ss) || /cancel/.test(cs)) continue;
    const cust = custById[j.customer_id] || {};
    const name = (s(j.customer_first || cust.first_name) + ' ' + s(j.customer_last || cust.last_name)).trim();
    const phone = digits(j.customer_phone || cust.phone || cust.mobile);
    const appl = s(j.appliance_type || j.appliance);
    if (!name && phone.length < 10 && !appl) continue;   // dead claim-shell, not real work
    active++;

    const jStreet = s(j.service_address), cStreet = s(cust.address);
    const street = jStreet || cStreet;
    const city = s(j.service_city) || s(cust.city);
    const zip = (digits(j.service_zip) || digits(cust.zip)).slice(0, 5);
    const reasons = [];
    // ADDRESS
    if (!street) reasons.push('no_street');
    else if (!hasStreetName(street)) reasons.push('number_only_street');
    if (!city) reasons.push('no_city');
    if (zip.length !== 5) reasons.push('bad_zip');
    if (jStreet && cStreet && jStreet.toLowerCase() !== cStreet.toLowerCase()) reasons.push('address_job_vs_customer_mismatch');
    // NAME
    const first = s(j.customer_first || cust.first_name), last = s(j.customer_last || cust.last_name);
    if (!first && !last) reasons.push('name_missing');
    else if (!first || !last) reasons.push('name_half_missing');           // only one of first/last
    else if (first.toLowerCase() === last.toLowerCase()) reasons.push('name_duplicated');   // "SMITH SMITH"
    else if ((/\s/.test(first) && !s(j.customer_last || cust.last_name)) || (/\s/.test(last) && !first)) reasons.push('name_unsplit');
    // PHONE
    const jP = digits(j.customer_phone).slice(-10), cP = digits(cust.phone || cust.mobile).slice(-10);
    if (phone.length < 10) reasons.push('no_phone');
    else if (jP && cP && jP !== cP) reasons.push('phone_job_vs_customer_mismatch');

    if (reasons.length) {
      reasons.forEach((r) => { byReason[r] = (byReason[r] || 0) + 1; });
      flagged.push({ id: j.id, name: name || '(no name)', first, last, phone: phone.slice(-10), status: ss, tech: Number(j.technician_id || 0), wc: j.warranty_company || '', street, job_street: jStreet, cust_street: cStreet, city, state: s(j.service_state) || s(cust.state), zip, reasons });
    } else clean++;
  }
  // Tech-assigned first (they roll soonest), then by id.
  flagged.sort((a, b) => ((b.tech > 0 ? 1 : 0) - (a.tech > 0 ? 1 : 0)) || (b.id - a.id));

  // BACKFILL: the real street is often ALREADY on the customer record; the job's stub
  // ("1" / empty) just masks it. Copy the customer's address onto the job wherever the
  // job's field is missing/bogus and the customer's is good. Never overwrites a good job
  // field. Requires ?secret + &confirm=1 (dry by default). (Teddy 2026-07-15 - build trust)
  if (q.backfill === '1') {
    const dry = q.confirm !== '1';
    const plan = []; let fixed = 0; const stillLost = [];
    for (const f of flagged) {
      const j = jobs.find((x) => x.id === f.id) || {};
      const cust = custById[j.customer_id] || {};
      const patch = {};
      const jStreetOk = s(j.service_address) && hasStreetName(s(j.service_address));
      if (!jStreetOk && hasStreetName(s(cust.address))) patch.service_address = s(cust.address);
      if (!s(j.service_city) && s(cust.city)) patch.service_city = s(cust.city);
      if (!s(j.service_state) && s(cust.state)) patch.service_state = s(cust.state);
      if (digits(j.service_zip).length !== 5 && digits(cust.zip).length >= 5) patch.service_zip = digits(cust.zip).slice(0, 5);
      if (!Object.keys(patch).length) {
        // Nothing on the customer record either -> the address is genuinely missing.
        if (f.reasons.includes('no_street') || f.reasons.includes('number_only_street')) stillLost.push({ id: f.id, name: f.name, city: f.city, tech: f.tech });
        continue;
      }
      plan.push({ job: f.id, name: f.name, patch });
      if (!dry) {
        try { const r = await fetch(`${META}/table/${JOBS}/content/${f.id}`, { method: 'PUT', headers: authH(), body: JSON.stringify(patch) }); if (r.ok) { fixed++; await fetch(`${META}/table/3/content`, { method: 'POST', headers: authH(), body: JSON.stringify({ action: 'address_backfilled_from_customer', metadata: { job_id: f.id, patch, at_ms: Date.now() } }) }).catch(() => {}); } } catch (_) {}
      }
    }
    return json(200, { ok: true, mode: dry ? 'DRY' : 'LIVE', active, would_fix: plan.length, fixed: dry ? 0 : fixed, still_lost: stillLost.length, still_lost_jobs: stillLost.slice(0, 60), plan: plan.slice(0, 60) });
  }

  return json(200, { ok: true, active, clean, flagged: flagged.length, by_reason: byReason, jobs: flagged.slice(0, 250) });
};
