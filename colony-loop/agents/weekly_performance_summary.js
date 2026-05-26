// Handles WEEKLY_PERFORMANCE_SUMMARY signals (emitted weekly from
// tick.js on Sundays 8-11am CT). Fans out per-tech PERFORMANCE_REQUEST_*
// signals so each tech's metrics get refreshed once per week. SMSes
// Teddy a single "emitted for N techs" confirmation.
//
// Per-tech consumer agents (PC001-PC010 — first_visit_fix_rate_coach,
// callback_rate, etc.) listen for their specific PERFORMANCE_REQUEST_*
// signal type. They're architect-built and live at
// performance_request_<scope>.js after the dispatch-convention fix.
import { toOwner } from '../sms.js';

const PER_TECH_SCOPES = [
  'first_visit_fix_rate',
  'diagnostic_accuracy',
  'time_per_job',
  'callback_rate',
  'tdr_completeness',
];

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let techs = [];
  try {
    const r = await xano.getTechnicians();
    techs = (r && r.items) || r || [];
  } catch (err) {
    log('weekly_performance_techs_load_failed', { error: String(err.message || err) });
    await xano.markSignalProcessed(signal.id, 'weekly_performance_summary_handled', {
      outcome: 'techs_load_failed',
    });
    return { success: false, action: 'techs_load_failed' };
  }

  // Skip Teddy (tech_id=1) — performance summaries don't make sense for the
  // owner. Skip inactive techs and the known orphan id=8 (empty record).
  const eligible = techs.filter((t) =>
    t && t.id && t.id !== 1 && t.active === true && t.first_name && String(t.first_name).trim()
  );

  if (eligible.length === 0) {
    const meta = { outcome: 'no_eligible_techs', total_techs: techs.length };
    await xano.markSignalProcessed(signal.id, 'weekly_performance_summary_handled', meta);
    log('weekly_performance_summary_handled', meta);
    return { success: true, action: 'no_eligible_techs' };
  }

  // Fan out per-tech × per-scope signals. The per-tech consumer agents
  // (performance_request_*.js) take care of context loading + Claude
  // analysis. Each fanout is a separate signal so the architect's
  // detector + dispatch can route independently.
  let emitted = 0;
  for (const tech of eligible) {
    for (const scope of PER_TECH_SCOPES) {
      try {
        await xano.emitSignal({
          signal_type: `PERFORMANCE_REQUEST_${scope.toUpperCase()}`,
          signal_strength: 45,
          payload: {
            tech_id: tech.id,
            tech_first_name: tech.first_name || '',
            tech_last_name: tech.last_name || '',
            window_days: 7,
            trigger: 'weekly_summary',
            source: 'weekly_performance_summary',
            source_signal_id: signal.id,
          },
        });
        emitted += 1;
      } catch (err) {
        log('weekly_performance_request_emit_failed', {
          tech_id: tech.id,
          scope,
          error: String(err.message || err),
        });
      }
    }
  }

  // Owner notification.
  const body =
    `[ant] weekly performance summaries emitted for ${eligible.length} techs ` +
    `(${emitted} signals across ${PER_TECH_SCOPES.length} scopes). ` +
    `Per-tech Claude analysis runs over the next ~5 min.`;
  let smsRes = null;
  try {
    smsRes = await toOwner(body, {
      action: 'weekly_performance_summary',
      tech_count: eligible.length,
      signals_emitted: emitted,
      source_signal_id: signal.id,
    });
  } catch (err) {
    smsRes = { success: false, error: String(err.message || err) };
  }

  // Persist a dedicated event_log row so the tick.js dedup picks this up.
  try {
    await xano.recordEventLog('weekly_performance_summary_emitted', {
      tech_count: eligible.length,
      signals_emitted: emitted,
      scopes: PER_TECH_SCOPES,
      source_signal_id: signal.id,
    });
  } catch (err) {
    log('weekly_performance_summary_emitted_persist_failed', { error: String(err.message || err) });
  }

  const meta = {
    outcome: 'summaries_emitted',
    tech_count: eligible.length,
    signals_emitted: emitted,
    sms_result: smsRes && smsRes.success ? 'ok' : 'maybe_failed',
  };
  await xano.markSignalProcessed(signal.id, 'weekly_performance_summary_handled', meta);
  log('weekly_performance_summary_handled', meta);

  return { success: true, action: 'summaries_emitted', tech_count: eligible.length };
}
