// CUSTOMER RE-ENGAGEMENT
//
// Fires Tuesday 10am CT (Tuesday is highest reply-rate weekday for
// non-urgent customer comms per industry research). Finds completed-
// job customers from 6-12 months ago with NO recent contact, and
// drafts a personalized maintenance-check SMS through composeForChannel.
//
// Why 6-12 months: too soon = annoying, > 18 months = customer has
// likely forgotten us / moved on. 6-12 is the sweet spot for "have
// you noticed any issues since our last visit?"
//
// Capped to 25 outbound SMSes per run to keep this conservative.
// Per-customer dedup: 90-day window so we don't pester.
//
// Revenue play: even 5% reply rate × 25 = 1-2 jobs / week. At
// $300 LTV per recovered customer that's $300-600/week revenue from
// otherwise-cold customers. Pure margin.
//
// Skipped if CUSTOMER_FACING_ENABLED=false (drafts only). When the
// gate flips on, agent goes live.

import { listRecentEventLog, recordEvent } from '../xano.js';
import { composeForChannel } from '../channel.js';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const MAX_OUTBOUND_PER_RUN = 25;
const DEDUP_DAYS = 90;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  // Pull customers whose most recent completed job is between 6 and
  // 12 months old via a dedicated lookup endpoint
  let candidates = [];
  try {
    const r = await fetch(`${XANO_BASE}/list_re_engagement_candidates?months_min=6&months_max=12&limit=200`, {
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const data = await r.json();
      candidates = (data && data.items) || [];
    }
  } catch (e) {
    log('re_engagement_query_failed', { error: String(e) });
    candidates = [];
  }

  if (candidates.length === 0) {
    await xano.markSignalProcessed(signal.id, 'customer_re_engagement_handled', { sent: 0, candidates: 0 });
    log('customer_re_engagement_no_candidates');
    return { success: true, action: 'no_candidates' };
  }

  // Filter out customers we've re-engaged in the last DEDUP_DAYS
  let recentDedup = [];
  try {
    recentDedup = await listRecentEventLog({
      action: 'customer_re_engaged',
      days_back: DEDUP_DAYS,
      limit: 1000,
    });
  } catch (_) {}
  const recentlyTouched = new Set();
  for (const row of recentDedup || []) {
    try {
      const m = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      if (m && m.customer_id) recentlyTouched.add(Number(m.customer_id));
    } catch (_) {}
  }
  const eligible = candidates.filter((c) => !recentlyTouched.has(Number(c.id)));

  if (eligible.length === 0) {
    await xano.markSignalProcessed(signal.id, 'customer_re_engagement_handled', { sent: 0, candidates: candidates.length, recently_touched: recentlyTouched.size });
    return { success: true, action: 'all_recently_touched' };
  }

  const targets = eligible.slice(0, MAX_OUTBOUND_PER_RUN);
  let sent = 0;
  let gated = 0;
  let failed = 0;

  for (const c of targets) {
    const monthsAgo = Math.round(c.months_since_last_job || 6);
    const intro = `hope all's well — it's been about ${monthsAgo} months since we worked on your ${c.last_appliance || 'appliance'}. Any new issues we can take care of?`;
    const inlineDetail = `Reply with what's going on and we'll get you on the schedule. Or just say "no" — no pressure.`;

    let composed;
    try {
      composed = await composeForChannel({
        customerId: Number(c.id),
        intro,
        inlineDetail,
        portalUrl: `https://tnapplianceexchange.net/customer-portal.html`,
        portalActionLabel: 'see past visits',
      });
    } catch (e) { failed += 1; continue; }

    try {
      const smsRes = await sms.toCustomer({
        phone: c.phone,
        body: composed.body,
        customer_id: c.id,
        call_site: 'customer_re_engagement',
      });
      if (smsRes && smsRes.gated) { gated += 1; }
      else if (smsRes && smsRes.ok) { sent += 1; }
      else { failed += 1; }
    } catch (_) { failed += 1; }

    try {
      await recordEvent('customer_re_engaged', {
        customer_id: c.id,
        months_since_last_job: monthsAgo,
        last_appliance: c.last_appliance || '',
        channel: composed.prefers,
        language: composed.language,
        sent_at_ms: Date.now(),
      });
    } catch (_) {}
  }

  await xano.markSignalProcessed(signal.id, 'customer_re_engagement_handled', {
    candidates: candidates.length,
    eligible: eligible.length,
    targeted: targets.length,
    sent, gated, failed,
  });
  log('customer_re_engagement_sent', { sent, gated, failed });
  return { success: true, action: 'sent', count: sent };
}
