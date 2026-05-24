import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(HERE, '..', 'rules', 'commission_rules.json');

function loadRules() {
  return JSON.parse(readFileSync(RULES_PATH, 'utf8'));
}

function commissionPctFor(techId, rules) {
  const byTech = rules.by_tech_id || {};
  if (byTech[techId]) return byTech[techId].pct;
  return rules.default_pct || 0.5;
}

export async function run(signal, ctx) {
  const { xano, sms } = ctx;
  const payload = signal.payload || {};
  const techId = Number(payload.tech_id);
  if (!techId) throw new Error('payload.tech_id required');

  const periodStartMs = Number(payload.period_start_ms) || (Date.now() - 14 * 24 * 60 * 60 * 1000);
  const periodEndMs = Number(payload.period_end_ms) || Date.now();

  const dashboard = await xano.getJobsForDashboard({ date_filter: 'all', page: 1, per_page: 200 });
  const items = dashboard.items || [];

  const completed = items.filter((r) => {
    const status = r.job?.scheduling_status;
    const finishedAt = r.job?.completed_at || r.job?.scheduled_start;
    const techMatch = r.tech?.id === techId;
    if (!techMatch) return false;
    if (status !== 'completed' && status !== 'submitted') return false;
    if (!finishedAt) return false;
    return finishedAt >= periodStartMs && finishedAt <= periodEndMs;
  });

  const rules = loadRules();
  const pct = commissionPctFor(String(techId), rules);

  let totalRevenue = 0;
  const breakdown = [];
  for (const r of completed) {
    const revenue = Number(r.job?.invoice_total || 0);
    totalRevenue += revenue;
    breakdown.push({
      job_id: r.job?.id,
      revenue,
      commission: revenue * pct,
    });
  }
  const totalOwed = totalRevenue * pct;

  const techName = completed[0]?.tech?.first_name || `tech ${techId}`;
  const lines = [
    `[ant] payroll calc: ${techName}`,
    `jobs: ${completed.length}  revenue: $${totalRevenue.toFixed(2)}`,
    `rate: ${(pct * 100).toFixed(0)}%  owed: $${totalOwed.toFixed(2)}`,
    `reply approve to pay  reject to hold`,
  ];

  const smsRes = await sms.toOwner(lines.join('\n'), {
    action: 'payroll_calculation',
    tech_id: techId,
    total_owed: totalOwed,
    job_count: completed.length,
  });

  return {
    success: true,
    action: 'payroll_calculated',
    tech_id: techId,
    job_count: completed.length,
    total_revenue: totalRevenue,
    total_owed: totalOwed,
    pct,
    breakdown,
    sms: smsRes,
  };
}
