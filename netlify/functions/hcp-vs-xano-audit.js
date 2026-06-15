// HCP vs Xano coverage audit.
//
// Pulls every job from HCP API in the last N days, then cross-checks
// against Xano to confirm a counterpart exists. Surfaces:
//   - covered:    HCP jobs that ARE in Xano (housecall_pro_job_id match)
//   - missing:    HCP jobs NOT in Xano — these are the gaps that would
//                 be LOST if we cut HCP today
//   - by_vendor:  rollup so we see which warranty companies are
//                 reliably emailing us (HCP + Xano) vs HCP-only
//
// This is the smoking gun for HCP-cut confidence. If 'missing' is
// consistently zero across multiple days, every dispatch is reaching us
// via Gmail intake. If missing > 0, those vendors must be onboarded to
// email us OR we accept the gap.

const HCP_BASE = 'https://api.housecallpro.com';
const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const { getSecret } = require('./_lib/secrets');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, '');

  const params = event.queryStringParameters || {};
  const daysBack = Math.min(Number(params.days || 7), 30);
  // env-first, then Xano vault — so HCP_API_KEY works whether it's scoped to
  // Functions or (to dodge the 4KB Lambda cap) stored in the app_config vault.
  const apiKey = await getSecret('HCP_API_KEY');
  const metaToken = process.env.XANO_METADATA_TOKEN;

  if (!apiKey) return cors(500, JSON.stringify({ error: 'HCP_API_KEY not in env or vault — add it in admin-secrets.html' }));
  if (!metaToken) return cors(500, JSON.stringify({ error: 'XANO_METADATA_TOKEN not configured' }));

  const sinceMs = Date.now() - daysBack * 86400000;
  const sinceIso = new Date(sinceMs).toISOString();

  // ── Step 1: pull HCP jobs (paginated) ──────────────────────────
  // Use scheduled_start_min (jobs scheduled in the window) — this gives
  // the real "is HCP fully synced to Xano?" picture. updated_after
  // (previous filter) only catches jobs touched recently which dramatically
  // undercounts (caught 10 in 7d when reality is ~170+).
  // We fetch both the scheduled-window AND recently-updated to catch jobs
  // that just moved status (e.g. now needs scheduling).
  const hcpJobs = [];
  const seenIds = new Set();
  for (const filterPair of [
    { kind: 'scheduled_start_min', value: sinceIso },
    { kind: 'updated_after', value: sinceIso },
  ]) {
    let page = 1;
    const maxPages = 20;
    while (page <= maxPages) {
      try {
        const url = `${HCP_BASE}/jobs?per_page=50&${filterPair.kind}=${encodeURIComponent(filterPair.value)}&page=${page}`;
        const r = await fetch(url, { headers: { Authorization: 'Token ' + apiKey } });
        if (!r.ok) {
          return cors(r.status, JSON.stringify({ error: 'hcp_fetch_failed', status: r.status, filter: filterPair.kind }));
        }
        const data = await r.json();
        const jobs = data.jobs || data || [];
        if (jobs.length === 0) break;
        for (const j of jobs) {
          if (j && j.id && !seenIds.has(j.id)) {
            seenIds.add(j.id);
            hcpJobs.push(j);
          }
        }
        page += 1;
        if (jobs.length < 50) break;
      } catch (err) {
        return cors(502, JSON.stringify({ error: 'hcp_fetch_threw', message: err.message, filter: filterPair.kind }));
      }
    }
  }

  // ── Step 2: pull Xano jobs (via Metadata API direct) ───────────
  // Use the jobs table id 7. Pull recent rows newest-first.
  let xanoJobs = [];
  try {
    let xPage = 1;
    while (xPage <= 5) {
      const r = await fetch(`${META_BASE}/table/7/content?page=${xPage}&per_page=500&sort=id&order=desc`, {
        headers: { Authorization: 'Bearer ' + metaToken },
      });
      const data = await r.json();
      const items = data.items || [];
      if (items.length === 0) break;
      xanoJobs.push(...items);
      if (items.length < 500) break;
      xPage += 1;
    }
  } catch (err) {
    return cors(502, JSON.stringify({ error: 'xano_fetch_threw', message: err.message }));
  }

  // Build Xano lookup by housecall_pro_job_id
  const xanoByHcpId = new Map();
  const xanoByClaim = new Map();
  for (const j of xanoJobs) {
    if (j.housecall_pro_job_id) xanoByHcpId.set(String(j.housecall_pro_job_id), j);
    if (j.claim_number) xanoByClaim.set(String(j.claim_number), j);
  }

  // ── Step 3: classify each HCP job ──────────────────────────────
  const covered = [];
  const missing = [];
  const byVendor = {};

  for (const h of hcpJobs) {
    const hcpId = String(h.id || '');
    const claim = String(h.tags?.find?.((t) => /^\d{6,}$/.test(t)) || '');
    const vendorRaw = (h.customer?.first_name || '') + ' ' + (h.customer?.last_name || '');
    // Heuristic vendor detection from job notes / description
    const desc = String(h.description || h.notes || '').toLowerCase();
    let vendor = 'unknown';
    if (/ahs|american home|frontdoor/.test(desc) || /ahs|frontdoor/.test(vendorRaw.toLowerCase())) vendor = 'ahs';
    else if (/servicepower|service power/.test(desc)) vendor = 'servicepower';
    else if (/squaretrade|square trade/.test(desc)) vendor = 'squaretrade';
    else if (/allstate/.test(desc)) vendor = 'allstate';
    else if (/nsa|national service alliance/.test(desc)) vendor = 'nsa';

    const xanoMatch = xanoByHcpId.get(hcpId) || (claim ? xanoByClaim.get(claim) : null);

    const summary = {
      hcp_id: hcpId,
      vendor,
      created_at: h.created_at,
      work_status: h.work_status,
      customer: h.customer ? `${h.customer.first_name || ''} ${h.customer.last_name || ''}`.trim() : '',
      description_preview: String(h.description || '').slice(0, 100),
      xano_id: xanoMatch ? xanoMatch.id : null,
      matched_by: xanoMatch ? (xanoByHcpId.get(hcpId) ? 'hcp_id' : 'claim') : null,
    };

    if (xanoMatch) covered.push(summary);
    else missing.push(summary);

    if (!byVendor[vendor]) byVendor[vendor] = { covered: 0, missing: 0, total: 0 };
    byVendor[vendor].total += 1;
    if (xanoMatch) byVendor[vendor].covered += 1; else byVendor[vendor].missing += 1;
  }

  // Sort missing by created_at (newest first) so the most urgent gaps surface
  missing.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  return cors(200, JSON.stringify({
    success: true,
    days_back: daysBack,
    hcp_total: hcpJobs.length,
    xano_total_scanned: xanoJobs.length,
    covered_count: covered.length,
    missing_count: missing.length,
    coverage_pct: hcpJobs.length > 0 ? Math.round((covered.length / hcpJobs.length) * 100) : 0,
    by_vendor: byVendor,
    missing: missing.slice(0, 50),
    covered_sample: covered.slice(0, 20),
  }, null, 2));
};

function cors(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body,
  };
}
