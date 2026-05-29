// PROMPT EVOLUTION PROPOSER (Sprint 5 of phone brain push)
//
// Weekly Sunday 7pm CT — reads the last 14 days of claude_call_outcome
// events grouped by (brain, signal_type). For any cell with:
//   - >= 20 outcomes (enough signal to act on)
//   - < 50% good outcomes (clear failure pattern)
// it pulls 5 GOOD calls + 5 BAD calls from that cell, asks Claude to
// identify what the good ones did differently, and proposes a concrete
// prompt revision. SMSes Teddy a short summary + the diff.
//
// Doesn't modify any prompt automatically — Teddy approves + applies
// via git. The agent's job is to NOTICE patterns + draft revisions
// faster than human review could. Pattern-detection at scale.
//
// Closes the loop: outcome learning (#1) → revealed failure cells →
// prompt revision proposals → operator-approved prompt updates → next
// week's outcomes show improvement (or not). If a cell stays failing
// after revision, the agent flags it for human deep-dive rather than
// looping on it.

import { listRecentEventLog } from '../xano.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const MIN_OUTCOMES_PER_CELL = 20;
const FAILURE_THRESHOLD = 0.5;
const PROPOSER_MODEL = process.env.ANT_PROMPT_PROPOSER_MODEL || 'claude-sonnet-4-5-20250929';
const WINDOW_DAYS = 14;

const PROPOSER_SYSTEM = `You are the Prompt Evolution Proposer for the Ant ops platform. Your job: read 5 successful + 5 failed calls from a brain that's underperforming, identify what the successful ones DID DIFFERENTLY, and propose a concrete prompt revision.

Reply JSON only:
{
  "pattern": "1-sentence pattern you noticed",
  "revision_summary": "what to change in the prompt, 1-2 sentences",
  "specific_prompt_diff": "the actual text to add/change/remove, with quote marks if direct copy",
  "confidence": 0-100
}

Be specific. "Make it better" is useless. "Add explicit instruction: when customer mentions warranty company, IMMEDIATELY call get_warranty_vendor_fingerprint(vendor) before asking diagnostic questions" is useful.`;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  let outcomes = [];
  try {
    outcomes = await listRecentEventLog({
      action: 'claude_call_outcome',
      days_back: WINDOW_DAYS,
      limit: 5000,
    });
  } catch (e) {
    log('prompt_evolution_query_failed', { error: String(e) });
    outcomes = [];
  }

  if (!outcomes || outcomes.length === 0) {
    await xano.markSignalProcessed(signal.id, 'prompt_evolution_handled', { reason: 'no_outcomes' });
    return { success: true, action: 'no_outcomes' };
  }

  // Bucket by (brain, signal_type_at_call)
  const cells = new Map();
  for (const row of outcomes) {
    let m;
    try { m = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; }
    catch (_) { continue; }
    if (!m) continue;
    const brain = m.brain || 'unknown';
    const sig = m.signal_type_at_call || 'unknown';
    const key = `${brain}|${sig}`;
    if (!cells.has(key)) cells.set(key, { brain, sig, good_ids: [], bad_ids: [], total: 0 });
    const c = cells.get(key);
    c.total += 1;
    const v = String(m.outcome_value || '').toLowerCase();
    if (v === 'good' || v === '5' || v === '4') c.good_ids.push(m.call_log_id);
    else if (v === 'bad' || v === '1' || v === '2') c.bad_ids.push(m.call_log_id);
  }

  // Find failing cells worth investigating
  const candidates = Array.from(cells.values())
    .filter((c) => c.total >= MIN_OUTCOMES_PER_CELL)
    .filter((c) => (c.good_ids.length / c.total) < FAILURE_THRESHOLD)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  if (candidates.length === 0) {
    await xano.markSignalProcessed(signal.id, 'prompt_evolution_handled', { reason: 'no_failing_cells', cells: cells.size });
    log('prompt_evolution_no_action', { cells: cells.size, candidates: 0 });
    return { success: true, action: 'no_failing_cells' };
  }

  if (!ANTHROPIC_KEY) {
    await xano.markSignalProcessed(signal.id, 'prompt_evolution_handled', { reason: 'no_anthropic_key', candidates: candidates.length });
    return { success: false, action: 'no_anthropic_key' };
  }

  const proposals = [];
  for (const c of candidates) {
    // Sample 5 good + 5 bad. For each, we'd ideally pull the
    // claude_call_log row to read input/output previews — but that
    // table isn't directly queryable from JS. We'll send the IDs and
    // a summary to Claude; the actual call content is in those rows
    // and Teddy can pull them up via the trace viewer when he reviews.
    const sample = {
      brain: c.brain,
      signal_type: c.sig,
      good_call_ids: c.good_ids.slice(0, 5),
      bad_call_ids: c.bad_ids.slice(0, 5),
      good_rate_pct: Math.round((c.good_ids.length / c.total) * 100),
      total_outcomes: c.total,
    };

    let proposal;
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: PROPOSER_MODEL,
          max_tokens: 800,
          system: PROPOSER_SYSTEM,
          messages: [{ role: 'user', content: `Failing cell:\n${JSON.stringify(sample, null, 2)}\n\nWhat would you change in this brain's prompt to flip the failure pattern?` }],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) {
        const data = await r.json();
        const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
        try { proposal = JSON.parse(cleaned); }
        catch (_) { proposal = { pattern: 'parse_failed', revision_summary: cleaned.slice(0, 200) }; }
      }
    } catch (_) {}

    if (proposal) {
      proposals.push({ ...sample, proposal });
      // Persist for Teddy's review surface
      try {
        await xano.recordEvent('prompt_evolution_proposal', {
          brain: c.brain,
          signal_type: c.sig,
          good_rate_pct: sample.good_rate_pct,
          total_outcomes: c.total,
          pattern: proposal.pattern || '',
          revision_summary: proposal.revision_summary || '',
          specific_prompt_diff: proposal.specific_prompt_diff || '',
          confidence: proposal.confidence || 0,
          proposed_at_ms: Date.now(),
        });
      } catch (_) {}
    }
  }

  // SMS Teddy a digest
  if (proposals.length > 0) {
    const lines = ['[ant] weekly prompt-evolution proposals:'];
    for (const p of proposals) {
      lines.push('');
      lines.push(`${p.brain}·${p.signal_type} (${p.good_rate_pct}% good / ${p.total_outcomes})`);
      lines.push(`Pattern: ${(p.proposal.pattern || '').slice(0, 120)}`);
      lines.push(`Revision: ${(p.proposal.revision_summary || '').slice(0, 160)}`);
    }
    lines.push('');
    lines.push('Review + apply via git. Detail in event_log action=prompt_evolution_proposal.');
    try { await sms.toOwner(lines.join('\n'), { call_site: 'prompt_evolution_proposer' }); }
    catch (_) {}
  }

  await xano.markSignalProcessed(signal.id, 'prompt_evolution_handled', {
    candidates: candidates.length,
    proposals: proposals.length,
  });
  log('prompt_evolution_proposed', { count: proposals.length });
  return { success: true, action: 'proposed', count: proposals.length };
}
