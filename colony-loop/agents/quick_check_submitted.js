// QUICK_CHECK_SUBMITTED — fires when a consumer submits the public
// /quick-check.html form. SMSes Teddy in real time with the verdict +
// customer contact + appliance summary so fresh consumer leads land on
// his phone the second they come in. He can intervene immediately if
// the verdict is "fix it with us" and the customer is still on-page.
//
// The submission was already persisted to event_log by the Xano
// endpoint (save_quick_check_submission). This agent's job is the
// alert + future automation hooks (auto-email, lead score, draft job).

import * as xano from '../xano.js';
import { toOwner } from '../sms.js';

export const signal_type = 'QUICK_CHECK_SUBMITTED';

export async function run(signal) {
  const payload = signal.payload || {};
  const customer = (payload.customer_name || '').trim() || '(no name)';
  const email = (payload.email || '').trim();
  const phone = (payload.phone || '').trim();
  const appliance = [payload.brand, payload.appliance_type].filter(Boolean).join(' ') || 'appliance';
  const problem = (payload.problem_summary || '').slice(0, 120);
  const zip = (payload.zip || '').trim();

  // Pull verdict from result_json if present (the analyzer result is
  // stored on the event_log row but not in the colony signal payload by
  // default — we may extend the Xano endpoint to forward result).
  let verdict = 'unknown';
  let headline = '';
  let costRange = '';
  try {
    if (payload.result_json) {
      const r = JSON.parse(payload.result_json);
      verdict = r.fix_or_replace || 'unknown';
      headline = r.verdict_headline || '';
      const lo = r.estimated_cash_repair_cost_low_cents;
      const hi = r.estimated_cash_repair_cost_high_cents;
      if (lo && hi) costRange = `$${Math.round(lo / 100)}-$${Math.round(hi / 100)}`;
    }
  } catch (_) {}

  const verdictEmoji = verdict === 'fix' ? '🔧'
                     : verdict === 'replace' ? '🗑️'
                     : '🤔';

  const jobId = payload.job_id;
  const teddyToolUrl = jobId
    ? `https://tnapplianceexchange.net/teddy-tdr-tool.html?job_id=${jobId}`
    : '';

  const teddyBody = [
    `[ant] $50 QUICK CHECK lead`,
    `${verdictEmoji} ${verdict.toUpperCase()}${headline ? ` · ${headline}` : ''}`,
    `${customer} · ${appliance}`,
    problem ? `"${problem}"` : '',
    [email, phone].filter(Boolean).join(' · '),
    costRange ? `Est: ${costRange}` : '',
    zip ? `ZIP: ${zip}` : '',
    teddyToolUrl ? `Open: ${teddyToolUrl}` : '',
  ].filter(Boolean).join('\n');

  await toOwner(teddyBody, {
    source: 'quick_check_lead',
    verdict,
    customer_name: customer,
    email,
    phone,
  });

  await xano.markSignalProcessed(signal.id, 'quick_check_lead_alerted', {
    customer_name: customer,
    email,
    verdict,
    cost_range: costRange,
  });

  return { success: true, action: 'lead_alerted', verdict };
}
