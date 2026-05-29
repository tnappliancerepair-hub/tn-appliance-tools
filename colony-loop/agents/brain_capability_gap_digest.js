// BRAIN CAPABILITY GAP DIGEST
//
// Fires weekly Sunday at 5pm CT. Reads brain_capability_gap event_log
// rows from the past 7 days — these are gaps the brains hit during
// live use that they couldn't fulfill with current tools. Groups by
// brain + gap_description, summarizes, SMSes Teddy with a digest +
// proposes which to architect next.
//
// Teddy's vision: "If there's a situation they're unable to handle,
// it should be brought to the agent's attention so that way we can
// build an agent to handle that."
//
// This is that loop. Brains call flag_capability_gap → this agent
// digests → Teddy approves → architect generates → next week's
// brains can handle it.

const CT_TZ = 'America/Chicago';

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  const todayMs = Date.now();
  const todayKey = new Date(todayMs).toISOString().slice(0, 10);
  const fired = await xano.checkEventLogFiredToday('brain_capability_gap_digest_fired', todayKey);
  if (fired) {
    await xano.markSignalProcessed(signal.id, 'brain_capability_gap_digest_skipped', { reason: 'already_fired_today' });
    return { success: true, action: 'skipped_already_fired' };
  }

  // Pull last 7 days of capability gap events
  let events = [];
  try {
    events = await xano.listRecentEventLog({ action: 'brain_capability_gap', days_back: 7, limit: 500 });
  } catch (e) {
    log('brain_capability_gap_fetch_failed', { error: e.message });
  }

  if (!events || events.length === 0) {
    await xano.recordEvent('brain_capability_gap_digest_fired', { day: todayKey, gaps_in_window: 0, sms_sent: false });
    await xano.markSignalProcessed(signal.id, 'brain_capability_gap_digest_done', { gaps: 0, sms_sent: false });
    return { success: true, action: 'no_gaps' };
  }

  // Group by (brain, gap_description) — normalize gap text for fuzzy dedup
  const groups = {};
  for (const row of events) {
    let meta;
    try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; }
    catch (_) { continue; }
    if (!meta) continue;
    const brain = String(meta.brain || 'unknown').toLowerCase();
    const gap = (meta.gap_description || '').slice(0, 200).trim();
    const key = brain + '::' + gap.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    if (!groups[key]) {
      groups[key] = {
        brain,
        gap_description: gap,
        count: 0,
        first_user_request: meta.user_request || '',
        first_proposed_solution: meta.proposed_solution || '',
        sample_event_log_ids: [],
      };
    }
    groups[key].count += 1;
    if (groups[key].sample_event_log_ids.length < 3) {
      groups[key].sample_event_log_ids.push(row.id);
    }
  }

  // Sort by frequency desc
  const ranked = Object.values(groups).sort((a, b) => b.count - a.count);

  // Compose SMS — top 5 gaps
  const lines = [];
  lines.push(`[ant] weekly capability gaps — ${events.length} flag(s) over ${ranked.length} unique gap(s):`);
  for (const g of ranked.slice(0, 5)) {
    lines.push(`• ${g.brain} (×${g.count}): ${g.gap_description.slice(0, 110)}`);
    if (g.first_proposed_solution) {
      lines.push(`  proposed: ${g.first_proposed_solution.slice(0, 90)}`);
    }
  }
  if (ranked.length > 5) {
    lines.push(`+${ranked.length - 5} more gap(s).`);
  }
  lines.push('');
  lines.push('Review + spec out new tools/agents to fill these — feeds back into architect on the next run.');

  const body = lines.join('\n');

  let smsResult;
  try {
    smsResult = await sms.toOwner(body, { call_site: 'brain_capability_gap_digest' });
  } catch (e) {
    smsResult = { ok: false, error: String(e) };
  }

  await xano.recordEvent('brain_capability_gap_digest_fired', {
    day: todayKey,
    gaps_in_window: events.length,
    unique_gaps: ranked.length,
    sms_sent: !!(smsResult && smsResult.ok),
    top_gaps: ranked.slice(0, 10).map((g) => ({ brain: g.brain, gap: g.gap_description, count: g.count })),
  });

  await xano.markSignalProcessed(signal.id, 'brain_capability_gap_digest_done', {
    gaps_in_window: events.length,
    unique_gaps: ranked.length,
    sms_ok: !!(smsResult && smsResult.ok),
  });

  log('brain_capability_gap_digest_sent', { gaps: events.length, unique: ranked.length });
  return { success: true, action: 'digest_sent', gaps: events.length, unique: ranked.length };
}
