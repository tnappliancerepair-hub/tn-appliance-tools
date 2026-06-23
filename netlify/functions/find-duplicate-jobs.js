// find-duplicate-jobs — OFFICE tool. Finds jobs that are the SAME warranty job
// duplicated, so they can be combined into one. Office-password gated.
//
// RULE (Teddy 2026-06-18): combine ONLY jobs that share the SAME claim number.
// The claim # is the one unambiguous identifier — two records with the same claim
// are definitively the same job. Nothing else merges (no name/address guessing),
// so there are ZERO false-positives. Jobs with no claim # are never auto-combined.
// (Pairs with the SquareTrade parser fix that ensures update emails carry the
// claim #, so the dupe + original share it and get caught here.)
//
// PERF: one bulk paginated jobs pass + one customers pass (for display names),
// joined in memory by customer_id.
//
//   POST { password }  ->  { ok, group_count, groups:[{ name, claim_number,
//                            address, appliance, keeper_job_id, jobs:[...] }] }
'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const CUSTOMER_TABLE = 6;
const JOBS_TABLE = 7;

exports.config = { timeout: 26 };

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

async function bulk(tableId, maxPages) {
  const PER = 250, BATCH = 6;
  const all = []; let stop = false;
  for (let base = 1; base <= maxPages && !stop; base += BATCH) {
    const pages = [];
    for (let p = base; p < base + BATCH && p <= maxPages; p++) pages.push(p);
    const batches = await Promise.all(pages.map(async (p) => {
      const r = await fetch(`${META}/table/${tableId}/content/search`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ sort: { id: 'desc' }, per_page: PER, page: p }),
      });
      if (!r.ok) return [];
      const j = await r.json().catch(() => ({}));
      return (j.items || []);
    }));
    for (const rows of batches) { all.push(...rows); if (rows.length < PER) stop = true; }
  }
  return all;
}

const DONE = /completed|canceled|cancelled/i;
function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const password = String(b.password || b.pin || '');
  if (!password) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'password_required' }) };
  try {
    const vr = await fetch(`${XANO}/verify_office_password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    });
    const vd = await vr.json().catch(() => ({}));
    if (!vd || !vd.success) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'wrong_password' }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'password_verify_failed' }) };
  }

  try {
    const [customers, jobsRaw] = await Promise.all([bulk(CUSTOMER_TABLE, 40), bulk(JOBS_TABLE, 40)]);
    const custById = {};
    for (const c of customers) custById[c.id] = c;

    // Test-job sweep: list every LIVE job that is a test — either tagged
    // (test_run_id) or named like a test. Read-only; caller cancels the ids.
    if (b.mode === 'test_names') {
      const TESTPAT = /\btest\b|smoke\s*test|smoketest|lifecycle|\bdemo\b|placeholder|do not use|sample customer|\bfake\b|\bqa\b|practice/i;
      const hits = [];
      for (const j of jobsRaw) {
        if (DONE.test(j.scheduling_status || '')) continue;
        const c = custById[j.customer_id] || {};
        const name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
        const tagged = String(j.test_run_id || '').trim();
        if (tagged || TESTPAT.test(name)) {
          hits.push({ id: j.id, name, test_run_id: tagged, status: j.scheduling_status || '', claim: j.claim_number || '' });
        }
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true, mode: 'test_names', count: hits.length, jobs: hits }, null, 2) };
    }

    // Group LIVE, non-test jobs by CLAIM NUMBER — the only identifier that proves
    // two records are the SAME job. Jobs with no claim # are never combined.
    const byClaim = {};
    for (const j of jobsRaw) {
      if (DONE.test(j.scheduling_status || '')) continue;
      if (String(j.test_run_id || '').trim()) continue;
      const claim = norm(j.claim_number);
      if (!claim) continue;
      const c = custById[j.customer_id] || {};
      (byClaim[claim] = byClaim[claim] || []).push({
        id: j.id, customer_id: j.customer_id,
        claim_number: j.claim_number || '',
        appliance_type: j.appliance_type || '',
        service_address: j.service_address || '',
        name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
        zip: c.zip || '', city: c.city || '',
        status: j.scheduling_status || '', created_at: j.created_at || 0,
      });
    }

    if (b.debug) {
      const claims2 = Object.keys(byClaim).filter((k) => byClaim[k].length >= 2);
      return { statusCode: 200, body: JSON.stringify({ ok: true, debug: true, jobs_scanned: jobsRaw.length, distinct_claims: Object.keys(byClaim).length, claims_with_2plus_jobs: claims2.length }, null, 2) };
    }

    const out = [];
    for (const claim of Object.keys(byClaim)) {
      const jobs = byClaim[claim];
      if (jobs.length < 2) continue; // same claim # on 2+ live jobs = dupe
      const keeper = jobs.find((j) => /scheduled/i.test(j.status)) ||
        jobs.slice().sort((a, c) => a.id - c.id)[0];
      const k = jobs[0];
      out.push({
        key: claim,
        name: k.name, claim_number: k.claim_number,
        address: keeper.service_address, zip: k.zip, city: k.city,
        appliance: keeper.appliance_type,
        keeper_job_id: keeper.id,
        jobs: jobs.sort((a, c) => (a.id === keeper.id ? -1 : 1)),
      });
    }
    out.sort((a, c) => c.jobs.length - a.jobs.length);

    // SAME-CUSTOMER REVIEW (Danielle, 2026-06-23): the claim-only rule above
    // misses self-pay dupes with no claim # (e.g. Matthew Peck — two open jobs,
    // one in Scheduled + one in a tech's Report). Surface any customer with 2+
    // LIVE jobs for REVIEW (could be two legit appliances) — never auto-combined.
    const byCust = {};
    for (const j of jobsRaw) {
      if (DONE.test(j.scheduling_status || '')) continue;
      if (String(j.test_run_id || '').trim()) continue;
      if (!j.customer_id) continue;
      (byCust[j.customer_id] = byCust[j.customer_id] || []).push(j);
    }
    const review = [];
    for (const cid of Object.keys(byCust)) {
      const jobs = byCust[cid];
      if (jobs.length < 2) continue;
      // skip if all share ONE claim # — those are already in the combine list.
      const claims = jobs.map((j) => norm(j.claim_number)).filter(Boolean);
      if (claims.length === jobs.length && new Set(claims).size === 1) continue;
      const c = custById[cid] || {};
      const name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
      if (/\bzztest|partsloop|chatcheck\b/i.test(name) || /^zztest/i.test(name) || name.toLowerCase() === 'james test') continue;
      review.push({
        customer_id: Number(cid), name, phone: c.phone || '', zip: c.zip || '', city: c.city || '',
        jobs: jobs.sort((a, d) => (Number(a.created_at) || 0) - (Number(d.created_at) || 0)).map((j) => ({
          id: j.id,
          appliance: [j.brand, j.appliance_type].filter(Boolean).join(' ') || j.appliance_type || '',
          status: j.scheduling_status || '', stage: j.office_stage || '',
          technician_id: j.technician_id || 0, customer_type: j.customer_type || '',
          claim_number: j.claim_number || '', created_at: j.created_at || 0,
        })),
      });
    }
    review.sort((a, c) => c.jobs.length - a.jobs.length);

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, group_count: out.length, groups: out, review_count: review.length, review_groups: review }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
