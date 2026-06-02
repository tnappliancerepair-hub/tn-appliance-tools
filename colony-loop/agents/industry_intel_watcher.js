// Signal in: INDUSTRY_INTEL_WATCH
// Fires weekly (Sun 11am-12pm CT). Asks Claude (Sonnet — composition
// task) to scan industry sources and produce a 5-bullet digest of:
//   - Vendor policy changes (AHS / ServicePower / SquareTrade)
//   - New failure-mode patterns in appliances
//   - Recall announcements
//   - Pricing / supply chain news affecting parts costs
//   - Competitor moves in our markets (TN, LA)
//
// No external API calls — relies on Claude's training cutoff awareness
// + on facts the operator may add to docs/industry-intel-context.md.
// Imperfect, but useful as a recurring nudge. When Anthropic adds
// web search to the agent SDK we'll wire that in.

import { config } from '../config.js';
import { callClaude, textFromResponse } from '../claude.js';

const SYSTEM = `You are an industry intelligence agent for a TN/LA appliance repair
business (TN Appliance Exchange). Each week you compose a SHORT digest
that helps the owner stay ahead of:

  - Vendor policy / contract changes (AHS, American Home Shield, ServicePower,
    SquareTrade, Allstate Protection, Frontdoor) that affect dispatch
    volumes, payment terms, or denial rates
  - New common failure-mode patterns in appliances (especially Whirlpool,
    Samsung, LG, GE, Frigidaire, Maytag — the brands they service most)
  - Recall announcements that could trigger repair surges
  - Parts pricing / supply chain news (Marcone, Tribles Appliance Parts, Reliable Parts)
  - Competitor moves in TN Metro + Hammond LA + Walker LA

Format your output as a JSON object:
{
  "vendor_changes": ["bullet 1", "bullet 2"],
  "failure_patterns": [...],
  "recalls": [...],
  "parts_supply": [...],
  "competitor_moves": [...],
  "headline_for_sms": "one-line headline the owner sees on his phone first"
}

Be HONEST about what you don't know. If you have no current intel for a
category, return an empty array. The owner trusts you because you
don't make things up. Better to say "no notable intel this week on
parts supply" than invent it.`;

export async function run(signal, ctx) {
  const { xano, sms, log } = ctx;

  let resp;
  try {
    resp = await callClaude({
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Compose this week\'s industry intel digest. Date today is ' + new Date().toISOString().slice(0, 10) + '. Return JSON only.' }],
      maxTokens: 1200,
      agentName: 'industry_intel_watcher',
      purpose: 'weekly industry intel digest',
      sourceSignalId: signal.id,
    });
  } catch (err) {
    const meta = { outcome: 'claude_failed', error: String(err.message || err) };
    await xano.markSignalProcessed(signal.id, 'industry_intel_handled', meta);
    log('industry_intel_claude_failed', meta);
    return { success: false, action: 'claude_failed' };
  }

  const text = textFromResponse(resp);
  let parsed = null;
  try {
    const stripped = text.replace(/```json/g, '').replace(/```/g, '').trim();
    parsed = JSON.parse(stripped);
  } catch (e) {
    const meta = { outcome: 'parse_failed', raw_preview: text.slice(0, 200) };
    await xano.markSignalProcessed(signal.id, 'industry_intel_handled', meta);
    log('industry_intel_parse_failed', meta);
    return { success: false, action: 'parse_failed' };
  }

  // Persist the full digest to event_log so future review surfaces it.
  try {
    await xano.recordEventLog('industry_intel_digest', {
      ...parsed,
      generated_at_ms: Date.now(),
      source_signal_id: signal.id,
    });
  } catch (_) {}

  const headline = (parsed.headline_for_sms || '').trim() || 'industry intel digest ready';
  const body = `[ant] weekly industry intel: ${headline.slice(0, 200)} — full digest in event_log (action=industry_intel_digest)`;

  let smsResult = 'skipped_no_owner_phone';
  if (config.ownerPhone) {
    try {
      const r = await sms.toOwner(body, {
        action: 'industry_intel_sms',
        source_signal_id: signal.id,
      });
      smsResult = r?.success ? 'ok' : (r?.error || 'failed');
    } catch (e) {
      smsResult = String(e.message || e);
    }
  }

  const meta = {
    outcome: 'digest_sent',
    headline,
    sections: {
      vendor_changes:   (parsed.vendor_changes || []).length,
      failure_patterns: (parsed.failure_patterns || []).length,
      recalls:          (parsed.recalls || []).length,
      parts_supply:     (parsed.parts_supply || []).length,
      competitor_moves: (parsed.competitor_moves || []).length,
    },
    sms_result: smsResult,
  };
  await xano.markSignalProcessed(signal.id, 'industry_intel_handled', meta);
  log('industry_intel_handled', meta);
  return { success: true, action: 'industry_intel_handled' };
}
