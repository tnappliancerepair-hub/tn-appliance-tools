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

  // Pull jobs scheduled within the day window (1-2 pages covers a day).
  const jobs = [];
  try {
    for (let page = 1; page <= 4; page++) {
      const url = `${HCP_BASE}/jobs?per_page=100&page=${page}&scheduled_start_min=${encodeURIComponent(minIso)}&scheduled_start_max=${encodeURIComponent(maxIso)}`;
      const r = await fetch(url, { headers: { Authorization: 'Token ' + apiKey } });
      if (!r.ok) { if (page === 1) return { statusCode: 200, body: JSON.stringify({ ok: false, error: `HCP ${r.status}` }) }; break; }
      const j = await r.json().catch(() => ({}));
      const arr = j.jobs || j.data || [];
      jobs.push(...arr);
      if (arr.length < 100) break;
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
    const stop = {
      time: ctTime(h.schedule && (h.schedule.scheduled_start || h.schedule.start_time)),
      scheduled_start: h.schedule && h.schedule.scheduled_start,
      customer: h.customer ? `${h.customer.first_name || ''} ${h.customer.last_name || ''}`.trim() : '',
      phone: (h.customer && (h.customer.mobile_number || h.customer.home_number)) || '',
      address: [a.street, a.city, a.state, a.zip].filter(Boolean).join(', '),
      what: h.description || (h.work_status || ''),
      status: h.work_status || '',
    };
    (byTech[techName] = byTech[techName] || []).push(stop);
  }
  for (const t of Object.keys(byTech)) {
    byTech[t].sort((x, y) => String(x.scheduled_start || '').localeCompare(String(y.scheduled_start || '')));
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, date: day, total: jobs.length, techs: Object.keys(byTech).length, by_tech: byTech }),
  };
};
