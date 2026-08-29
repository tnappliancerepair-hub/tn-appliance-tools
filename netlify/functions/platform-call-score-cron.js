// platform-call-score-cron — nightly, grade every active shop's Ann and store the score.
//
// Runs the accuracy audit (platform-call-score) once a day for every company that has active
// jobs, so each shop's owner sees a fresh accuracy read + a trend (the "better every day"
// signal). Split from the on-demand endpoint because a scheduled Netlify fn edge-403s on
// manual HTTP — this wrapper just fires the audit per tenant. Runs via netlify.toml schedule.
'use strict';

const { getSecret } = require('./_lib/secrets');
const svc = require('./platform-call-score');

exports.handler = async function () {
  const url = ((await getSecret('PLATFORM_SUPABASE_URL')) || 'https://tntbhfwitytkcoqlejwc.supabase.co').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!key) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'platform_not_configured' }) };
  const H = { apikey: key, Authorization: 'Bearer ' + key };

  // companies that actually have active work — the ones worth grading
  let ids = [];
  try {
    const r = await fetch(`${url}/rest/v1/job?status=not.in.(completed,canceled)&select=company_id&limit=3000`, { headers: H, signal: AbortSignal.timeout(12000) });
    const rows = r.ok ? (await r.json().catch(() => [])) : [];
    ids = [...new Set(rows.map((x) => x.company_id).filter(Boolean))].slice(0, 60);
  } catch (_) {}

  let audited = 0;
  for (const id of ids) {
    try { const a = await svc.audit(id, 30); await svc.store(id, a); audited++; } catch (_) {}
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, companies: ids.length, audited }) };
};
