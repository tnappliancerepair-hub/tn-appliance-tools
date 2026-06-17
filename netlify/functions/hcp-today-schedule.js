// hcp-today-schedule — pulls TODAY's jobs straight from Housecall Pro (the
// source of truth the office actually scheduled into) and groups them by tech,
// so the guys can get their real route today even while Ant's calendar is being
// reconciled. HCP key comes from the vault (env-first, then Xano app_config).
//
//   GET /.netlify/functions/hcp-today-schedule         (today, CT)
//   GET ...?date=2026-06-16                            (specific day)

'use strict';

const HCP_BASE = 'https://api.housecallpro.com';
const { getSecret } = require('./_lib/secrets');

function ctDate(d) { return new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
function ctTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
}

exports.handler = async (event) => {
  const qp = event.queryStringParameters || {};
  const apiKey = await getSecret('HCP_API_KEY');
  if (!apiKey) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'HCP_API_KEY not in env or vault' }) };

  const day = qp.date || ctDate(Date.now());
  const minIso = new Date(`${day}T00:00:00-05:00`).toISOString();
  const maxIso = new Date(`${day}T23:59:59-05:00`).toISOString();

  // DEBUG: see how HCP returns the data (job count, schedule shape, whether
  // appointments are separate) so we can mirror the full schedule, not a subset.
  if (qp.debug === '1') {
    const out = {};
    const tries = {
      jobs_sched_window: `/jobs?per_page=100&scheduled_start_min=${encodeURIComponent(minIso)}&scheduled_start_max=${encodeURIComponent(maxIso)}`,
      jobs_no_filter: `/jobs?per_page=100&page=1`,
      appointments_window: `/appointments?per_page=100&scheduled_start_min=${encodeURIComponent(minIso)}&scheduled_start_max=${encodeURIComponent(maxIso)}`,
    };
    for (const [k, path] of Object.entries(tries)) {
      try {
        const r = await fetch(`${HCP_BASE}${path}`, { headers: { Authorization: 'Token ' + apiKey } });
        const j = await r.json().catch(() => ({}));
        const arr = j.jobs || j.appointments || j.data || [];
        out[k] = { status: r.status, count: arr.length, total: j.total_items || j.total || j.page_count, sample_keys: arr[0] ? Object.keys(arr[0]).slice(0, 25) : [], sample_schedule: arr[0] && arr[0].schedule };
      } catch (e) { out[k] = { error: String(e.message) }; }
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, day, probe: out }, null, 2) };
  }

  // Pull jobs scheduled within the day window. HCP caps pages small and uses
  // page_size (not per_page) — so paginate until we've got them all (stop on an
  // empty page or once we've collected the reported total).
  const jobs = [];
  try {
    let total = Infinity;
    for (let page = 1; page <= 15; page++) {
      const url = `${HCP_BASE}/jobs?page_size=100&per_page=100&page=${page}&scheduled_start_min=${encodeURIComponent(minIso)}&scheduled_start_max=${encodeURIComponent(maxIso)}`;
      const r = await fetch(url, { headers: { Authorization: 'Token ' + apiKey } });
      if (!r.ok) { if (page === 1) return { statusCode: 200, body: JSON.stringify({ ok: false, error: `HCP ${r.status}` }) }; break; }
      const j = await r.json().catch(() => ({}));
      if (typeof j.total_items === 'number') total = j.total_items;
      const arr = j.jobs || j.data || [];
      jobs.push(...arr);
      if (arr.length === 0 || jobs.length >= total) break;
    }
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }

  // Group by assigned tech.
  const byTech = {};
  for (const h of jobs) {
    const emps = h.assigned_employees || h.assigned_employee || [];
    const techName = (Array.isArray(emps) ? emps : [emps])
      .map((e) => `${(e && e.first_name) || ''} ${(e && e.last_name) || ''}`.trim()).filter(Boolean).join(', ') || 'Unassigned';
    const a = h.address || {};
    const cu = h.customer || {};
    const sch = h.schedule || {};
    const startIso = sch.scheduled_start || sch.start_time || null;
    const endIso = sch.scheduled_end || sch.end_time || null;
    const toMs = (iso) => { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) ? t : null; };
    const stop = {
      time: ctTime(startIso),
      scheduled_start: startIso,
      customer: `${cu.first_name || ''} ${cu.last_name || ''}`.trim(),
      phone: cu.mobile_number || cu.home_number || '',
      address: [a.street, a.city, a.state, a.zip].filter(Boolean).join(', '),
      what: h.description || (h.work_status || ''),
      status: h.work_status || '',
      // raw fields for tap-to-work (import_hcp_job contract)
      hcp_id: String(h.id || ''),
      hcp_job_number: h.invoice_number || h.job_number || '',
      first_name: cu.first_name || '',
      last_name: cu.last_name || '',
      email: cu.email || '',
      street: a.street || '', city: a.city || '', state: a.state || '', zip: a.zip || '',
      scheduled_start_ms: toMs(startIso),
      scheduled_end_ms: toMs(endIso),
      description: h.description || '',
      work_status: h.work_status || '',
    };
    (byTech[techName] = byTech[techName] || []).push(stop);
  }
  for (const t of Object.keys(byTech)) {
    byTech[t].sort((x, y) => String(x.scheduled_start || '').localeCompare(String(y.scheduled_start || '')));
  }

  // ?tech_id=N -> just that tech's stops (for the tech dashboard's read-only HCP
  // mirror). Matches HCP names loosely by first name (HCP shows "Jimmy P" etc.)
  // and includes shared jobs (e.g. "Teddy Pivacek, Lee Harding").
  const ROSTER = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };
  const techId = qp.tech_id ? Number(qp.tech_id) : 0;
  if (techId && ROSTER[techId]) {
    const first = ROSTER[techId].toLowerCase();
    const mine = [];
    for (const [name, stops] of Object.entries(byTech)) {
      if (name.toLowerCase().includes(first)) mine.push(...stops);
    }
    mine.sort((x, y) => String(x.scheduled_start || '').localeCompare(String(y.scheduled_start || '')));
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, date: day, tech_id: techId, tech_first: ROSTER[techId], count: mine.length, my_stops: mine }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, date: day, total: jobs.length, techs: Object.keys(byTech).length, by_tech: byTech }),
  };
};
