// One-shot diagnostic: for a given Xano tech_id (and their HCP hcp_id),
// pull today's HCP jobs assigned to that pro AND today's Xano jobs
// assigned to that tech, and surface the diff. Use to debug "why does
// HCP show N jobs but Ant only shows M for the same tech today?"
//
// GET /.netlify/functions/tech-hcp-vs-xano-today?tech_id=2&hcp_id=pro_e4e4a77e88be413bb2d9ec2335f579da

const HCP_BASE = 'https://api.housecallpro.com';
const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';

function todayCT() {
  // Day boundaries in CT
  const now = new Date();
  const ctStr = now.toLocaleString('sv-SE', { timeZone: 'America/Chicago' });
  const dateStr = ctStr.slice(0, 10);
  const startCT = new Date(`${dateStr}T00:00:00-05:00`).toISOString();
  const endCT = new Date(`${dateStr}T23:59:59-05:00`).toISOString();
  return { dateStr, startCT, endCT };
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const techId = Number(params.tech_id || 0);
  const hcpId = String(params.hcp_id || '');
  const apiKey = process.env.HCP_API_KEY;
  const metaToken = process.env.XANO_METADATA_TOKEN;

  if (!techId || !hcpId) return { statusCode: 400, body: JSON.stringify({ error: 'tech_id + hcp_id required' }) };
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'HCP_API_KEY missing' }) };
  if (!metaToken) return { statusCode: 500, body: JSON.stringify({ error: 'XANO_METADATA_TOKEN missing' }) };

  const { dateStr, startCT, endCT } = todayCT();

  // ── HCP: pull a wider window so we catch jobs with unusual scheduling
  // states (needs scheduled, on hold, in progress today even if start
  // date is past). Get last 14 days of touched-jobs + today's
  // scheduled_start window — union to surface anything Jimmy might be
  // looking at in his HCP today view. Filter by assignment after fetch.
  const hcpJobs = [];
  const seenIds = new Set();
  const widerSince = new Date(Date.now() - 14 * 86400000).toISOString();
  for (const filter of [
    `scheduled_start_min=${encodeURIComponent(startCT)}&scheduled_start_max=${encodeURIComponent(endCT)}`,
    `updated_after=${encodeURIComponent(widerSince)}`,
  ]) {
    for (let page = 1; page <= 8; page++) {
      const url = `${HCP_BASE}/jobs?${filter}&page=${page}&per_page=100`;
      let r;
      try {
        r = await fetch(url, {
          headers: { Authorization: `Token ${apiKey}`, Accept: 'application/json' },
        });
      } catch (e) {
        return { statusCode: 502, body: JSON.stringify({ error: 'hcp_fetch_failed: ' + e.message }) };
      }
      if (!r.ok) {
        const tx = await r.text().catch(() => '');
        return { statusCode: 502, body: JSON.stringify({ error: 'hcp_non_2xx', status: r.status, body: tx.slice(0, 400) }) };
      }
      const d = await r.json();
      const items = (d && Array.isArray(d.jobs)) ? d.jobs : (Array.isArray(d) ? d : []);
      for (const j of items) {
        if (!seenIds.has(j.id)) { seenIds.add(j.id); hcpJobs.push(j); }
      }
      const total = d && d.page_count ? d.page_count : 1;
      if (page >= total || items.length === 0) break;
    }
  }

  // Filter HCP to ones assigned to this pro. Track sched-date too so we
  // can split into today vs other.
  const hcpMineAll = hcpJobs.filter((j) => {
    const pros = j.assigned_employees || [];
    return pros.some((p) => p && p.id === hcpId);
  }).map((j) => {
    const schedRaw = (j.schedule && j.schedule.scheduled_start) || j.scheduled_start || '';
    let schedDateCT = '';
    try {
      if (schedRaw) schedDateCT = new Date(schedRaw).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10);
    } catch (_) {}
    return {
      hcp_id: j.id,
      work_status: j.work_status || '',
      scheduled_start: schedRaw,
      sched_date_ct: schedDateCT,
      is_today: schedDateCT === dateStr,
      customer: j.customer ? `${j.customer.first_name || ''} ${j.customer.last_name || ''}`.trim() : '',
      customer_phone: j.customer && (j.customer.mobile_number || j.customer.phone_number || '') || '',
      description: (j.description || '').slice(0, 80),
    };
  });
  const hcpMine = hcpMineAll.filter((j) => j.is_today);
  const hcpMineOtherDays = hcpMineAll.filter((j) => !j.is_today);

  // ── Xano: jobs scheduled today assigned to this tech ──
  const jobsTableId = 7;
  const xanoJobs = [];
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`${META_BASE}/table/${jobsTableId}/content?page=${page}&per_page=200&sort=-created_at`, {
      headers: { Authorization: `Bearer ${metaToken}` },
    });
    if (!r.ok) break;
    const d = await r.json();
    const items = (d && d.items) || [];
    for (const j of items) {
      const sched = j.scheduled_start || 0;
      if (!sched) continue;
      const schedDate = new Date(Number(sched)).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10);
      if (schedDate === dateStr && Number(j.technician_id) === techId) {
        xanoJobs.push({
          xano_id: j.id,
          hcp_id: j.housecall_pro_job_id || '',
          scheduling_status: j.scheduling_status || '',
          scheduled_start: new Date(Number(sched)).toISOString(),
          appliance_type: j.appliance_type || j.appliance || '',
          customer_id: j.customer_id || 0,
          intake_source: j.intake_source || '',
        });
      }
    }
    const total = (d && d.pageTotal) || 1;
    if (page >= total) break;
  }

  // Build the diff
  const xanoHcpIds = new Set(xanoJobs.map((j) => j.hcp_id).filter(Boolean));
  const hcpMineIds = new Set(hcpMine.map((j) => j.hcp_id));

  const hcpOnly = hcpMine.filter((j) => !xanoHcpIds.has(j.hcp_id));
  const xanoOnly = xanoJobs.filter((j) => !j.hcp_id || !hcpMineIds.has(j.hcp_id));
  const both = hcpMine.filter((j) => xanoHcpIds.has(j.hcp_id));

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      date_ct: dateStr,
      tech_id: techId,
      hcp_id: hcpId,
      summary: {
        hcp_total_assigned_to_tech_14d_window: hcpMineAll.length,
        hcp_assigned_today: hcpMine.length,
        hcp_assigned_other_days: hcpMineOtherDays.length,
        xano_assigned_today: xanoJobs.length,
        in_both_today: both.length,
        hcp_only_today: hcpOnly.length,
        xano_only_today: xanoOnly.length,
      },
      hcp_only_jobs: hcpOnly,
      xano_only_jobs: xanoOnly,
      both,
      hcp_other_days_sample: hcpMineOtherDays.slice(0, 20),
    }, null, 2),
  };
};
