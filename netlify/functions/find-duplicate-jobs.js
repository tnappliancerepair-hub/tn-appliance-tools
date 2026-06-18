// find-duplicate-jobs — OFFICE tool. Finds customers with multiple jobs that are
// really the SAME ticket and should be combined into one. Office-password gated.
//
// Rule (Teddy 2026-06-18): group by NAME, then combine everything into one
// ticket UNLESS two jobs are provably DISTINCT real jobs:
//   • different (non-empty) job numbers AND different addresses (multi-home
//     owners / separate locations stay separate), OR
//   • different (non-empty) appliance types (fridge + washer at one house = two
//     real tickets).
// Catches self-checkout triple-submits (Cathy), SquareTrade update dupes, etc.
//
// PERF: pulls recent JOB rows in one bulk paginated pass (the rows already carry
// customer_first_name/last_name + address + appliance), then groups + clusters in
// memory — no per-customer lookups (which timed out under a slow metadata API).
//
//   POST { password }  ->  { ok, group_count, groups:[{ name, address, appliance,
//                            keeper_job_id, jobs:[...] }] }
'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const JOBS_TABLE = 7;

exports.config = { timeout: 26 };

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

// Bulk-pull recent job rows (id desc), batched.
async function recentJobs() {
  const PER = 250, MAX_PAGES = 40, BATCH = 6;
  const all = []; let stop = false;
  for (let base = 1; base <= MAX_PAGES && !stop; base += BATCH) {
    const pages = [];
    for (let p = base; p < base + BATCH && p <= MAX_PAGES; p++) pages.push(p);
    const batches = await Promise.all(pages.map(async (p) => {
      const r = await fetch(`${META}/table/${JOBS_TABLE}/content/search`, {
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
function jobNumOf(j) { return norm(j.claim_number || j.job_number || j.dispatch_number || ''); }
function addrOf(j) {
  return (norm(j.service_address || j.address) + '|' + norm(j.service_zip || j.zip || ''))
    .replace(/[^a-z0-9|]/g, '');
}
function applOf(j) { return norm(j.appliance_type || j.appliance || ''); }

// Two jobs are provably DISTINCT real jobs (do NOT merge) when:
//   different non-empty job#s AND different addresses, OR different appliances.
function areDistinct(a, b) {
  const jnA = jobNumOf(a), jnB = jobNumOf(b);
  const jobNumsDiffer = !!jnA && !!jnB && jnA !== jnB;
  const adA = addrOf(a), adB = addrOf(b);
  const adAbare = adA.replace(/\|/g, ''), adBbare = adB.replace(/\|/g, '');
  const addrsDiffer = !!adAbare && !!adBbare && adA !== adB;
  if (jobNumsDiffer && addrsDiffer) return true;     // multi-home / separate locations
  const apA = applOf(a), apB = applOf(b);
  if (apA && apB && apA !== apB) return true;         // different appliance = different ticket
  return false;
}

// Union-find: cluster a name's jobs into "same ticket" sets.
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
    const jobsRaw = await recentJobs();

    if (b.debug) {
      const sample = (jobsRaw || []).slice(0, 4).map((j) => ({
        id: j.id, customer_id: j.customer_id,
        customer_first_name: j.customer_first_name, customer_last_name: j.customer_last_name,
        service_address: j.service_address, appliance_type: j.appliance_type,
        claim_number: j.claim_number, job_number: j.job_number, scheduling_status: j.scheduling_status,
        field_names: Object.keys(j).filter((k) => /name|address|appliance|claim|job_num|customer/i.test(k)),
      }));
      const withName = (jobsRaw || []).filter((j) => (j.customer_first_name || j.customer_last_name)).length;
      return { statusCode: 200, body: JSON.stringify({ ok: true, debug: true, jobs_scanned: (jobsRaw || []).length, jobs_with_name_on_row: withName, sample }, null, 2) };
    }

    // Group LIVE (non-terminal, non-test) jobs by customer name carried on the row.
    const byName = {};
    for (const j of jobsRaw) {
      if (DONE.test(j.scheduling_status || '')) continue;
      if (String(j.test_run_id || '').trim()) continue; // test jobs handled separately
      const fn = norm(j.customer_first_name), ln = norm(j.customer_last_name);
      if (!fn && !ln) continue;
      const key = `${fn} ${ln}`.trim();
      (byName[key] = byName[key] || []).push({
        id: j.id, customer_id: j.customer_id,
        claim_number: j.claim_number || '', job_number: j.job_number || '', dispatch_number: j.dispatch_number || '',
        appliance_type: j.appliance_type || '',
        service_address: j.service_address || '', service_zip: j.service_zip || j.zip || '',
        customer_first_name: j.customer_first_name || '', customer_last_name: j.customer_last_name || '',
        status: j.scheduling_status || '', created_at: j.created_at || 0,
      });
    }

    const out = [];
    for (const key of Object.keys(byName)) {
      const jobs = byName[key];
      if (jobs.length < 2) continue;
      // One name → possibly multiple clusters (e.g. a multi-home owner).
      const clusters = clusterJobs(jobs);
      for (const cluster of clusters) {
        if (cluster.length < 2) continue; // only real dupes
        const keeper = cluster.find((j) => jobNumOf(j)) ||
          cluster.find((j) => /scheduled/i.test(j.status)) ||
          cluster.slice().sort((a, c) => a.id - c.id)[0];
        const k = cluster[0];
        out.push({
          key: key + '|' + (keeper ? keeper.id : ''),
          name: `${k.customer_first_name || ''} ${k.customer_last_name || ''}`.trim(),
          address: keeper ? keeper.service_address : '',
          zip: keeper ? keeper.service_zip : '',
          appliance: keeper ? keeper.appliance_type : '',
          keeper_job_id: keeper ? keeper.id : null,
          jobs: cluster.sort((a, c) => (a.id === (keeper && keeper.id) ? -1 : 1)),
        });
      }
    }
    out.sort((a, c) => c.jobs.length - a.jobs.length);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, group_count: out.length, groups: out }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }
};
