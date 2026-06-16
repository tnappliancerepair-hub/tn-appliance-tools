// find-duplicate-jobs — OWNER-ONLY. Finds people who got duplicated by the
// SquareTrade-style intake (same name + zip across multiple customer records /
// jobs, mostly with an empty claim#). Returns groups so the office can keep the
// real job and cancel the rest. Gated by Teddy's tech PIN (technician_id 1).
//
//   POST { pin }  ->  { ok, groups:[{ key, name, zip, jobs:[...], keeper_job_id }] }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const SITE = 'https://tnapplianceexchange.net';
const CUSTOMER_TABLE = 6;
const JOBS_TABLE = 7;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

async function recentCustomers() {
  const PER = 200, MAX_PAGES = 24, BATCH = 6;
  const all = []; let stop = false;
  for (let base = 1; base <= MAX_PAGES && !stop; base += BATCH) {
    const pages = [];
    for (let p = base; p < base + BATCH && p <= MAX_PAGES; p++) pages.push(p);
    const batches = await Promise.all(pages.map(async (p) => {
      const r = await fetch(`${META}/table/${CUSTOMER_TABLE}/content/search`, {
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

async function jobsForCustomer(customerId) {
  const r = await fetch(`${META}/table/${JOBS_TABLE}/content/search`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ search: { customer_id: customerId }, sort: { created_at: 'desc' }, per_page: 20, page: 1 }),
  });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j.items || []);
}

const DONE = /completed|canceled|cancelled/i;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  // Office-accessible (was owner-PIN): gate by the office password so Danielle
  // can run it. (Teddy 2026-06-16 — "remove the owner pin gate".)
  const password = String(b.password || b.pin || '');
  if (!password) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'password_required' }) };
  try {
    const vr = await fetch('https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/verify_office_password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    });
    const vd = await vr.json().catch(() => ({}));
    if (!vd || !vd.success) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'wrong_password' }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'password_verify_failed' }) };
  }

  try {
    const customers = await recentCustomers();
    // Group customers by normalized name + zip.
    const groups = {};
    for (const c of customers) {
      const fn = String(c.first_name || '').trim().toLowerCase();
      const ln = String(c.last_name || '').trim().toLowerCase();
      const zip = String(c.zip || '').trim();
      if (!fn && !ln) continue;
      const key = `${fn} ${ln}|${zip}`.trim();
      (groups[key] = groups[key] || []).push(c);
    }
    // Keep only groups with 2+ customer records (the dupes).
    const dupeKeys = Object.keys(groups).filter((k) => groups[k].length >= 2);

    const out = [];
    for (const key of dupeKeys.slice(0, 60)) {
      const custs = groups[key];
      // Gather each customer's jobs.
      const jobArrays = await Promise.all(custs.map((c) => jobsForCustomer(c.id)));
      const jobs = [];
      jobArrays.forEach((arr, i) => {
        for (const j of arr) {
          jobs.push({
            id: j.id, customer_id: j.customer_id,
            claim_number: j.claim_number || '',
            status: j.scheduling_status || '',
            created_at: j.created_at || 0,
            terminal: DONE.test(j.scheduling_status || ''),
          });
        }
      });
      const liveJobs = jobs.filter((j) => !j.terminal);
      if (liveJobs.length < 2) continue; // only show real active dupes
      // Suggested keeper: has a claim#, else scheduled, else oldest.
      let keeper = liveJobs.find((j) => j.claim_number) ||
        liveJobs.find((j) => /scheduled/i.test(j.status)) ||
        liveJobs.slice().sort((a, c) => a.id - c.id)[0];
      const c0 = custs[0];
      out.push({
        key,
        name: `${c0.first_name || ''} ${c0.last_name || ''}`.trim(),
        zip: c0.zip || '',
        city: c0.city || '',
        customer_records: custs.length,
        keeper_job_id: keeper ? keeper.id : null,
        jobs: liveJobs.sort((a, c) => (a.id === (keeper && keeper.id) ? -1 : 1)),
      });
    }
    out.sort((a, c) => c.jobs.length - a.jobs.length);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, group_count: out.length, groups: out }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
