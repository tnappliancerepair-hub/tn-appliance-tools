// job-data-audit — data-quality check on the live job set so the board can be TRUSTED
// (Teddy 2026-07-16: "I want our app to be the most trusted — check that names and
// addresses are correct and not incomplete"). A tech can't find "1, LA"; an office can't
// bill "TEST"; a warranty claim bounces on a blank name. This finds every live job whose
// customer NAME or service ADDRESS is missing, garbled, or incomplete, categorized so the
// office can backfill from the AHS/ServicePower dispatch (claim# + dispatch id included).
//
// READ-ONLY. Fixes nothing — just surfaces. The job set is the board feed itself
// (get_office_kanban, the ~500 real live jobs), enriched with each customer's street
// address (table 6, which the board feed doesn't carry).
//
//   GET               -> summary + first 200 flagged
//   GET ?issue=street_number_only  -> only that issue
//   GET ?full=1       -> all flagged (no 200 cap)
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CUSTOMER = crud.TABLES.customer; // 6

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }

const STATE_CODES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);

// Names that are placeholders, not people.
const JUNK_NAME = /^(test|zz+|zztest|unknown|n\/?a|none|null|customer|tenant|resident|occupant|homeowner|na|xx+|asdf|qwerty|aaa+)$/i;

// Human-readable label + severity per issue code, for the report.
const ISSUE_META = {
  missing_name:        { sev: 'high', label: 'No customer name' },
  partial_name:        { sev: 'med',  label: 'Only a first OR last name' },
  name_has_digits:     { sev: 'med',  label: 'Digits in the name (address bled in?)' },
  placeholder_name:    { sev: 'high', label: 'Placeholder/junk name (TEST, Tenant…)' },
  missing_street:      { sev: 'high', label: 'No street address' },
  street_number_only:  { sev: 'high', label: 'Street is just a number — no street name (the "1, LA" bug)' },
  street_incomplete:   { sev: 'med',  label: 'Street looks incomplete (no street name)' },
  missing_city:        { sev: 'high', label: 'No city' },
  city_is_state_code:  { sev: 'high', label: 'City is a 2-letter state code' },
  city_equals_state:   { sev: 'high', label: 'City equals state' },
  missing_state:       { sev: 'med',  label: 'No state' },
  bad_state:           { sev: 'med',  label: 'State is not a valid 2-letter code' },
  missing_zip:         { sev: 'high', label: 'No ZIP' },
  bad_zip:             { sev: 'med',  label: 'ZIP is not 5 digits' },
};

function nameIssues(first, last) {
  const f = String(first || '').trim();
  const l = String(last || '').trim();
  const full = (f + ' ' + l).trim();
  const out = [];
  if (!f && !l) { out.push('missing_name'); return out; }
  if (!f || !l) out.push('partial_name');
  if (/\d/.test(full)) out.push('name_has_digits');
  const letters = full.replace(/[^a-z]/gi, '');
  if (JUNK_NAME.test(f) || JUNK_NAME.test(l) || JUNK_NAME.test(full) || letters.length < 2) out.push('placeholder_name');
  return out;
}

function addrIssues(street, city, state, zip) {
  const s = String(street || '').trim();
  const c = String(city || '').trim();
  const st = String(state || '').trim();
  const z = String(zip || '').replace(/\D/g, '');
  const out = [];
  if (!s) out.push('missing_street');
  else if (/^\d+\s*$/.test(s)) out.push('street_number_only');            // "1", "123" — AHS parser dropped the street name
  else if (!/\s/.test(s) || s.replace(/[^a-z]/gi, '').length < 2) out.push('street_incomplete');
  if (!c) out.push('missing_city');
  else if (c.length <= 2 && STATE_CODES.has(c.toUpperCase())) out.push('city_is_state_code');
  if (!st) out.push('missing_state');
  else if (!STATE_CODES.has(st.toUpperCase())) out.push('bad_state');
  if (!z) out.push('missing_zip');
  else if (z.length !== 5) out.push('bad_zip');
  if (c && st && c.toLowerCase() === st.toLowerCase()) out.push('city_equals_state');
  return out;
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};

  // 1) The live job set = the board feed itself (already the ~500 real, non-shell jobs).
  let jobs = [];
  try {
    const d = await (await fetch(`${XANO}/get_office_kanban`, { signal: AbortSignal.timeout(25000) })).json();
    jobs = d.items || d.jobs || [];
  } catch (_) {
    return json(200, { ok: false, error: 'board_feed_unreachable' });
  }

  // 2) Build a customer_id -> street-address map (the board feed omits the street line;
  //    it lives on the customer row, table 6). Page the customer table once.
  const custMap = new Map();
  const needed = new Set(jobs.map((j) => Number(j.customer_id)).filter(Boolean));
  for (let page = 1; page <= 12; page++) {
    let rows = [];
    try { rows = await crud.searchPageN(CUSTOMER, {}, { id: 'desc' }, 500, page); } catch (_) { break; }
    if (!rows.length) break;
    for (const cst of rows) { if (needed.has(Number(cst.id))) custMap.set(Number(cst.id), cst); }
    if (rows.length < 500) break;
  }

  // 3) Validate each job's name + effective service address.
  const flagged = [];
  const issueCounts = {};
  let clean = 0;
  for (const j of jobs) {
    const cst = custMap.get(Number(j.customer_id)) || {};
    const street = cst.address || cst.address_line1 || '';
    const city  = j.service_city  || cst.city  || '';
    const state = j.service_state || cst.state || '';
    const zip   = j.service_zip   || cst.zip   || '';

    const issues = [
      ...nameIssues(j.customer_first, j.customer_last),
      ...addrIssues(street, city, state, zip),
    ];
    if (!issues.length) { clean++; continue; }

    issues.forEach((i) => { issueCounts[i] = (issueCounts[i] || 0) + 1; });
    const hasHigh = issues.some((i) => (ISSUE_META[i] || {}).sev === 'high');
    flagged.push({
      id: j.id,
      name: ((j.customer_first || '') + ' ' + (j.customer_last || '')).trim() || '(blank)',
      appliance: j.appliance || j.appliance_type || '',
      warranty_company: j.warranty_company || '',
      claim_number: j.claim_number || '',
      dispatch_source_id: j.dispatch_source_id || '',
      technician_id: j.technician_id || 0,
      scheduling_status: j.scheduling_status || '',
      street, city, state, zip,
      issues,
      severity: hasHigh ? 'high' : 'med',
      customer_id: j.customer_id || 0,
    });
  }

  // High severity first, then by newest job id.
  flagged.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
    return Number(b.id) - Number(a.id);
  });

  let list = flagged;
  if (q.issue) list = list.filter((f) => f.issues.includes(q.issue));

  const highCount = flagged.filter((f) => f.severity === 'high').length;
  return json(200, {
    ok: true,
    scanned: jobs.length,
    clean,
    flagged_count: flagged.length,
    high_severity: highCount,
    customers_loaded: custMap.size,
    issue_counts: issueCounts,
    issue_meta: ISSUE_META,
    flagged: q.full ? list : list.slice(0, 200),
  });
};
