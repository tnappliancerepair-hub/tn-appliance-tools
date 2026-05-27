// Handles TDR_COMPLETENESS_REPORT signals (emitted daily 6:30pm CT by
// tick.js — right after daily_revenue_summary). For each tech with
// completed jobs today, compute their TDR completeness % and send
// Teddy a per-tech rollup.
//
// Pairs with tdr_reminder (4pm push to techs with open TDRs) and the
// server-side TDR gate (blocks warranty+repair_complete). This is the
// "end-of-day report card" view.
import { config } from '../config.js';
import { toOwner } from '../sms.js';

function bareDomain() {
  return (config.publicSiteBase || '').replace(/^https?:\/\//, '');
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let payload;
  try {
    payload = await xano.getTechsWithOpenTdr();
  } catch (err) {
    log('tdr_completeness_report_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'tdr_completeness_report_handled', {
      outcome: 'load_failed',
      error: String(err.message || err),
    });
    return { success: false, action: 'load_failed' };
  }

  // getTechsWithOpenTdr returns techs with INCOMPLETE TDRs today. To compute
  // full per-tech %, we'd ideally have a "completed jobs today, per-tech" call.
  // For v1, just surface the open list — it's the actionable view.
  const techs = (payload && payload.techs) || [];
  if (techs.length === 0) {
    const body = `[ant] 📋 EOD TDR check: all techs caught up on today's jobs. ✓`;
    try {
      await toOwner(body, {
        action: 'tdr_completeness_report_sent',
        outcome: 'all_complete',
        source_signal_id: signal.id,
      });
    } catch (err) {
      log('tdr_completeness_report_sms_failed', { error: String(err.message || err) });
    }
    await xano.markSignalProcessed(signal.id, 'tdr_completeness_report_handled', {
      outcome: 'all_complete',
    });
    return { success: true, action: 'all_complete' };
  }

  // Compose per-tech digest
  const lines = techs.map((t) => {
    const name = String(t.tech_first || '').trim() || `tech#${t.tech_id}`;
    const open = (t.jobs || []).length;
    return `• ${name}: ${open} open`;
  });

  const totalOpen = techs.reduce((acc, t) => acc + (t.jobs || []).length, 0);
  const body =
    `[ant] 📋 EOD TDR check: ${totalOpen} job${totalOpen === 1 ? '' : 's'} ` +
    `still missing fields across ${techs.length} tech${techs.length === 1 ? '' : 's'}:\n` +
    lines.join('\n') +
    `\nReview: ${bareDomain()}/office-todo.html (TDR-blocked tab)`;

  let smsRes = null;
  try {
    smsRes = await toOwner(body, {
      action: 'tdr_completeness_report_sent',
      outcome: 'open_tdrs',
      tech_count: techs.length,
      total_open_jobs: totalOpen,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  const meta = {
    outcome: 'open_tdrs',
    tech_count: techs.length,
    total_open_jobs: totalOpen,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'tdr_completeness_report_handled', meta);
  log('tdr_completeness_report_handled', meta);

  return { success: true, action: 'open_tdrs', ...meta };
}
