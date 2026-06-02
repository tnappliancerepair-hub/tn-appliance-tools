// Signal in: DAILY_CLAUDE_SPEND_CHECK
// Fires daily at 8am CT (tick.js maybeEmitTimeSignals). Sums the last
// 24h of claude_call_log rows and SMSes Teddy when the cost crossed
// the configured alert threshold. Cheap insurance against runaway
// loops or model-mis-routing chewing through tokens overnight.
//
// Threshold: config.dailyClaudeSpendAlertUsd (env DAILY_CLAUDE_SPEND_ALERT_USD,
// default $25/day).
//
// Always SMSes a daily summary (even under threshold) once the system
// has been running with logging for a few days — gives Teddy a steady
// pulse on spend without having to log into the Anthropic console.

import { config } from '../config.js';

const INTAKE = (path) => `${config.xanoIntakeBase}${path}`;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  let summary;
  try {
    const r = await fetch(INTAKE('/get_claude_spend_summary?hours_back=24'));
    summary = await r.json();
  } catch (err) {
    const meta = { outcome: 'fetch_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'daily_claude_spend_handled', meta);
    log('daily_claude_spend_fetch_failed', meta);
    return { success: false, action: 'fetch_failed' };
  }

  if (!summary || !summary.success) {
    const meta = { outcome: 'summary_unsuccessful', payload: summary };
    await xano.markSignalProcessed(signal.id, 'daily_claude_spend_handled', meta);
    log('daily_claude_spend_summary_failed', meta);
    return { success: false, action: 'summary_unsuccessful' };
  }

  const calls    = Number(summary.total_calls || 0);
  const tokensIn = Number(summary.total_tokens_in || 0);
  const tokensOut = Number(summary.total_tokens_out || 0);
  const cost     = Number(summary.total_cost_usd || 0);
  const threshold = config.dailyClaudeSpendAlertUsd;

  // Per-agent breakdown — top 5 by call count (cheap proxy for cost in
  // the absence of group-by SQL). Agents that should rarely fire but
  // are at the top of this list deserve a look.
  const byAgent = {};
  for (const r of (summary.recent_rows || [])) {
    const k = r.agent_name || '(unknown)';
    byAgent[k] = (byAgent[k] || 0) + 1;
  }
  const topAgents = Object.entries(byAgent)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([n, c]) => `${n}:${c}`)
    .join(' ');

  const isAlert = cost > threshold;
  const tag = isAlert ? '⚠️ ALERT' : 'daily';

  // Always SMS a summary so Teddy gets the daily pulse. Alert format
  // when over threshold so it's visually distinct on the lock screen.
  const body =
    `[ant] ${tag} Claude spend (last 24h): $${cost.toFixed(2)} ` +
    `(${calls} calls, ${formatTokens(tokensIn)}in / ${formatTokens(tokensOut)}out). ` +
    `Top: ${topAgents}. ` +
    `Threshold: $${threshold.toFixed(2)}.`;

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, {
        action: 'daily_claude_spend_summary',
        cost_usd: cost,
        calls,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        is_alert: isAlert,
      });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (err) {
      smsResult = String(err.message || err);
    }
  }

  const meta = {
    outcome: isAlert ? 'alert_sent' : 'summary_sent',
    cost_usd: cost,
    calls,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    threshold,
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'daily_claude_spend_handled', meta);
  log('daily_claude_spend_handled', meta);
  return { success: true, action: 'daily_claude_spend_handled', cost_usd: cost };
}

function formatTokens(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
