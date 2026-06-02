// Signal in: DAILY_HCP_COVERAGE_CHECK
// Fires daily at 8-9am CT. Calls the /hcp-vs-xano-audit Netlify
// function (7-day window), reads coverage_pct + missing_count, SMSes
// Teddy. ALERT badge when missing > 0 so gaps to email-collection
// surface immediately.
//
// This is the daily gate-check for HCP-cut confidence: if coverage
// stays at 100% over many days, every dispatch is reaching us via
// Gmail intake. If it drops, those vendors need to be onboarded to
// email OR we accept the gap before cutting HCP.

import { config } from '../config.js';

const AUDIT_URL = (config.netlifyFunctionsBase || 'https://superlative-naiad-233aa7.netlify.app/.netlify/functions') + '/hcp-vs-xano-audit?days=7';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  let summary;
  try {
    const r = await fetch(AUDIT_URL);
    summary = await r.json();
  } catch (err) {
    const meta = { outcome: 'fetch_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'daily_hcp_coverage_handled', meta);
    log('daily_hcp_coverage_fetch_failed', meta);
    return { success: false, action: 'fetch_failed' };
  }

  if (!summary || !summary.success) {
    const meta = { outcome: 'audit_failed', error: summary?.error || 'unknown' };
    await xano.markSignalProcessed(signal.id, 'daily_hcp_coverage_handled', meta);
    return { success: false, action: 'audit_failed' };
  }

  const total = Number(summary.hcp_total || 0);
  const covered = Number(summary.covered_count || 0);
  const missing = Number(summary.missing_count || 0);
  const pct = Number(summary.coverage_pct || 0);
  const byVendor = summary.by_vendor || {};

  const hasMissing = missing > 0;
  const tag = hasMissing ? '⚠️ GAP' : 'daily';

  // Build top vendors with missing > 0 for the SMS body
  const gapVendors = Object.entries(byVendor)
    .filter(([_, s]) => s.missing > 0)
    .sort((a, b) => b[1].missing - a[1].missing)
    .slice(0, 3)
    .map(([v, s]) => `${v}:${s.missing}/${s.total}`);

  const body =
    `[ant] ${tag} HCP coverage (7d): ${pct}% (${covered}/${total} matched). ` +
    (hasMissing
      ? `Missing: ${missing}. Gaps: ${gapVendors.join(', ') || '(by_vendor unknown)'}. ` +
        `Email collection needs those vendors. View: tnapplianceexchange.net/email-intake-status.html`
      : `All dispatches reached Xano. HCP-cut gate is green.`);

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, {
        action: 'daily_hcp_coverage_summary',
        coverage_pct: pct,
        covered_count: covered,
        missing_count: missing,
        hcp_total: total,
        has_missing: hasMissing,
      });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (err) {
      smsResult = String(err.message || err);
    }
  }

  const meta = {
    outcome: hasMissing ? 'alert_sent' : 'summary_sent',
    coverage_pct: pct,
    covered_count: covered,
    missing_count: missing,
    hcp_total: total,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'daily_hcp_coverage_handled', meta);
  log('daily_hcp_coverage_handled', meta);
  return { success: true, action: 'daily_hcp_coverage_handled', coverage_pct: pct };
}
