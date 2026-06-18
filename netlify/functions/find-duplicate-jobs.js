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

// ── Teddy's dedup rule (2026-06-18) ──────────────────────────────────────────
// Group candidates by NAME, then within a name combine everything into one
// ticket UNLESS two jobs are provably DISTINCT real jobs:
//   • different (non-empty) job numbers AND different addresses, OR
//   • different (non-empty) appliance types  ← safety so a washer + dryer at the
//     same house (two real claims) don't get merged into one.
// Everything else (same address, or blank job#s, or a self-checkout submitted
// 3×) collapses to a single ticket.
function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function jobNumOf(j) { return norm(j.claim_number || j.job_number || j.dispatch_number || ''); }
function addrOf(j) {
  return (norm(j.service_address || j.address) + '|' + norm(j.service_zip || j.zip || ''))
    .replace(/[^a-z0-9|]/g, '');
}
function applOf(j) { return norm(j.appliance_type || j.appliance || ''); }

function areDistinct(a, b) {
  const jnA = jobNumOf(a), jnB = jobNumOf(b);
  const jobNumsDiffer = !!jnA && !!jnB && jnA !== jnB;
  const adA = addrOf(a), adB = addrOf(b);
  const addrsDiffer = adA.replace(/\|/g, '') && adB.replace(/\|/g, '') && adA !== adB;
  if (jobNumsDiffer && addrsDiffer) return true;            // Teddy's rule
  const apA = applOf(a), apB = applOf(b);
  if (apA && apB && apA !== apB) return true;               // safety: different appliance
  return false;
}

// Union-find: cluster a name's jobs into "same ticket" groups.
function clusterJobs(jobs) {
  const parent = jobs.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i, j) => { parent[find(i)] = find(j); };
  for (let i = 0; i < jobs.length; i++)
    for (let j = i + 1; j < jobs.length; j++)
      if (!areDistinct(jobs[i], jobs[j])) union(i, j);
  const comps = {};
  for (let i = 0; i < jobs.length; i++) { const r = find(i); (comps[r] = comps[r] || []).push(jobs[i]); }
  return Object.values(comps);
}

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
    // Group candidates by NAME (address / job# / appliance discriminate WITHIN a
    // name — see areDistinct/clusterJobs).
    const byName = {};
    for (const c of customers) {
      const fn = norm(c.first_name), ln = norm(c.last_name);
      if (!fn && !ln) continue;
      const key = `${fn} ${ln}`.trim();
      (byName[key] = byName[key] || []).push(c);
    }
    // The dupe pattern makes a NEW customer record each intake, so only names
    // with 2+ records are candidates. Bound the work.
    const nameKeys = Object.keys(byName).filter((k) => byName[k].length >= 2).slice(0, 80);

    const out = [];
    for (const nk of nameKeys) {
      const custs = byName[nk];
      const jobArrays = await Promise.all(custs.map((c) => jobsForCustomer(c.id)));
      const allJobs = [];
      jobArrays.forEach((arr) => {
        for (const j of arr) {
          allJobs.push({
            id: j.id, customer_id: j.customer_id,
            claim_number: j.claim_number || '', job_number: j.job_number || '',
            dispatch_number: j.dispatch_number || '',
            appliance_type: j.appliance_type || '',
            service_address: j.service_address || '', service_zip: j.service_zip || j.zip || '',
            status: j.scheduling_status || '',
            created_at: j.created_at || 0,
            terminal: DONE.test(j.scheduling_status || ''),
          });
        }
      });
      const liveJobs = allJobs.filter((j) => !j.terminal);
      if (liveJobs.length < 2) continue;
      // Cluster into "same ticket" sets. A single name can yield MULTIPLE groups
      // (e.g. a multi-home owner → one group per address).
      const clusters = clusterJobs(liveJobs);
      const c0 = custs[0];
      for (const cluster of clusters) {
        if (cluster.length < 2) continue; // only real dupes
        const keeper = cluster.find((j) => jobNumOf(j)) ||
          cluster.find((j) => /scheduled/i.test(j.status)) ||
          cluster.slice().sort((a, b) => a.id - b.id)[0];
        out.push({
          key: nk + '|' + (keeper ? keeper.id : ''),
          name: `${c0.first_name || ''} ${c0.last_name || ''}`.trim(),
          zip: c0.zip || '', city: c0.city || '',
          address: keeper ? keeper.service_address : '',
          appliance: keeper ? keeper.appliance_type : '',
          customer_records: custs.length,
          keeper_job_id: keeper ? keeper.id : null,
          jobs: cluster.sort((a, b) => (a.id === (keeper && keeper.id) ? -1 : 1)),
        });
      }
    }
    out.sort((a, b) => b.jobs.length - a.jobs.length);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, group_count: out.length, groups: out }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
