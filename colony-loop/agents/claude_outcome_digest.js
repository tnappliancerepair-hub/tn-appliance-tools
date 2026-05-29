// WEEKLY CLAUDE OUTCOME DIGEST
//
// Sunday 6pm CT (next tick after office_eod runs) — reads the last 7
// days of claude_call_outcome events and computes hit rates per cell:
//
//   (brain, signal_type_at_call) → {
//     calls_with_outcomes, good_pct, bad_pct, mean_confidence
//   }
//
// SMSes Teddy the top-3 cells by volume + the worst-performing cell
// so he sees where the brains are paying off and where they aren't.
//
// This is the "are we actually getting smarter" feedback loop. Pair it
// with the prompt-evolution work in #8 (capability-gap → architect):
// when a cell shows consistently poor results, that's a prompt that
// needs work — not just a tool that's missing.
//
// Fires from tick.js Sunday 18:00-21:00 CT grace window via
// CLAUDE_OUTCOME_DIGEST signal type.

import { listRecentEventLog } from '../xano.js';

const CT_TZ = 'America/Chicago';

export async function run(signal, ctx) {
  const { sms, log, xano } = ctx;

  let rows = [];
  try {
    rows = await listRecentEventLog({
      action: 'claude_call_outcome',
      days_back: 7,
      limit: 5000,
    });
  } catch (e) {
    log('claude_outcome_digest_query_failed', { error: String(e) });
    rows = [];
  }

  if (!rows || rows.length === 0) {
    await xano.markSignalProcessed(signal.id, 'claude_outcome_digest_handled', {
      action: 'no_outcomes_to_report',
    });
    log('claude_outcome_digest_empty');
    return { success: true, action: 'no_outcomes' };
  }

  // Bucket by (brain, signal_type_at_call). value/confidence summed +
  // counted per bucket.
  const cells = new Map();
  for (const row of rows) {
    let m;
    try { m = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; }
    catch (_) { continue; }
    if (!m) continue;
    const brain = m.brain || 'unknown';
    const sig = m.signal_type_at_call || 'unknown';
    const key = `${brain}|${sig}`;
    if (!cells.has(key)) {
      cells.set(key, { brain, sig, total: 0, good: 0, bad: 0, neutral: 0, confSum: 0, confCount: 0 });
    }
    const c = cells.get(key);
    c.total += 1;
    const v = String(m.outcome_value || '').toLowerCase();
    if (v === 'good' || v === '5' || v === '4') c.good += 1;
    else if (v === 'bad' || v === '1' || v === '2') c.bad += 1;
    else c.neutral += 1;
    const conf = Number(m.confidence_pct || 0);
    if (conf > 0) { c.confSum += conf; c.confCount += 1; }
  }

  const summaries = Array.from(cells.values()).map((c) => ({
    ...c,
    good_pct: c.total ? Math.round((c.good / c.total) * 100) : 0,
    bad_pct: c.total ? Math.round((c.bad / c.total) * 100) : 0,
    mean_conf: c.confCount ? Math.round(c.confSum / c.confCount) : 0,
  }));

  const top3ByVolume = [...summaries].sort((a, b) => b.total - a.total).slice(0, 3);
  const worstByGood = [...summaries].filter((c) => c.total >= 5).sort((a, b) => a.good_pct - b.good_pct)[0];

  const lines = [`[ant] weekly brain-outcome digest (${rows.length} outcomes / 7d)`];
  lines.push('');
  lines.push('Top by volume:');
  for (const c of top3ByVolume) {
    lines.push(`  ${c.brain}·${shortSig(c.sig)} — ${c.total} outcomes, ${c.good_pct}% good${c.mean_conf ? ', conf ' + c.mean_conf + '%' : ''}`);
  }
  if (worstByGood && worstByGood.good_pct < 60) {
    lines.push('');
    lines.push(`Worst (≥5 outcomes): ${worstByGood.brain}·${shortSig(worstByGood.sig)} — only ${worstByGood.good_pct}% good across ${worstByGood.total}`);
    lines.push(`Prompt for that cell may need work.`);
  }
  lines.push('');
  lines.push(`See dashboard: tnapplianceexchange.net/operator-status.html`);

  const body = lines.join('\n');
  let smsResult;
  try { smsResult = await sms.toOwner(body, { call_site: 'claude_outcome_digest' }); }
  catch (e) { smsResult = { ok: false, error: String(e) }; }

  await xano.markSignalProcessed(signal.id, 'claude_outcome_digest_handled', {
    cells: summaries.length,
    outcomes_total: rows.length,
    sms_ok: !!(smsResult && smsResult.ok),
  });
  log('claude_outcome_digest_sent', { cells: summaries.length });
  return { success: true, action: 'sent' };
}

function shortSig(s) {
  return String(s || '').toLowerCase().replace(/_/g, ' ').slice(0, 28);
}
