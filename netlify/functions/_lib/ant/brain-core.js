// Shared multi-turn Claude tool-calling loop. Used by every Ant brain.
//
// Each brain provides: systemPrompt, tools array, userContent, history.
// Brain-core handles: calling Claude, parsing tool_use blocks, executing
// tools, sending tool_results back, looping until Claude returns final
// text. Returns the final text + a log of every tool call made.
//
// Decoupled from any one role — same loop serves tech, office, customer,
// scheduler brains. The differences live in the per-brain system prompt
// + tool subset.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL_DEFAULT = 'claude-sonnet-4-5-20250929';
const CLAUDE_TIMEOUT_MS_DEFAULT = 30_000;
const XANO_LOG_ENDPOINT = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/log_claude_call';

const { executeTool } = require('./tools');
const { calcCallCost, checkSpendGate, recordSpend } = require('./spend');

// Fire-and-forget log writer. Best-effort; we never want to slow a
// brain response down by waiting on the log POST. The outcome-linker
// agent reads these rows later to attribute outcomes to calls.
function _logCallAsync(payload) {
  try {
    fetch(XANO_LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (_) {}
}

async function runBrainTurn({
  systemPrompt,
  userContent,
  history = [],
  tools = [],
  ctx = {},
  maxIterations = 5,
  model = MODEL_DEFAULT,
  maxTokens = 2000,
  claudeTimeoutMs = CLAUDE_TIMEOUT_MS_DEFAULT,
}) {
  if (!ANTHROPIC_KEY) {
    return { reply: '', tool_calls: [], status: 0, error: 'ANTHROPIC_API_KEY not configured' };
  }

  // Spend gate (#3) — non-critical calls get blocked once today's
  // in-memory spend crosses ANT_DAILY_SPEND_CAP_USD. Critical paths
  // (ctx.critical=true — Tech Assist mid-job, customer-facing replies)
  // continue until the hard cap. Mark Tech Assist / customer / scheduler
  // as critical by default since blocking them mid-conversation breaks
  // the customer experience.
  const isCritical = ctx.critical === true
    || ['tech_assist', 'customer_ant', 'scheduler', 'tech_scheduler'].includes(ctx.brain);
  const gate = checkSpendGate({ critical: isCritical });
  if (!gate.allow) {
    return {
      reply: '',
      tool_calls: [],
      status: 0,
      error: 'spend_gate_blocked: ' + gate.reason,
      spend_gate: gate,
    };
  }

  // Build messages array: history (sanitized to role+content), then current user turn
  const messages = [];
  if (Array.isArray(history)) {
    for (const turn of history) {
      if (turn && turn.role && turn.content) {
        messages.push({ role: turn.role, content: turn.content });
      }
    }
  }
  messages.push({ role: 'user', content: userContent });

  const toolCallsLog = [];
  let finalText = '';
  let lastStatus = 0;
  const callStartedAt = Date.now();
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), claudeTimeoutMs);
    let resp;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          // Prompt caching: the system prompt is large + static across every turn of a
          // live chat (customer/office/website/tech-assist/scheduler/phone/troubleshoot).
          // Marking it ephemeral lets Anthropic serve it from cache on turn 2+ — big TTFT
          // + cost win, zero output change. Mirrors colony-loop/claude.js. (2026-07-13)
          system: systemPrompt
            ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
            : undefined,
          tools,
          messages,
        }),
        signal: ac.signal,
      });
      clearTimeout(t);
    } catch (err) {
      clearTimeout(t);
      return {
        reply: '',
        tool_calls: toolCallsLog,
        status: 0,
        error: 'claude_call_failed: ' + (err.message || err),
      };
    }
    lastStatus = resp.status;
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return {
        reply: '',
        tool_calls: toolCallsLog,
        status: resp.status,
        error: 'claude_non_2xx: ' + errBody.slice(0, 300),
      };
    }
    const data = await resp.json();
    if (data.usage) {
      totalTokensIn += Number(data.usage.input_tokens || 0);
      totalTokensOut += Number(data.usage.output_tokens || 0);
    }
    const blocks = data.content || [];
    const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use');
    const textBlocks = blocks.filter((b) => b.type === 'text');

    if (toolUseBlocks.length === 0) {
      // No more tool calls — Claude has its final answer
      finalText = textBlocks.map((b) => b.text).join('').trim();
      break;
    }

    // Echo assistant turn back into messages (full content block array)
    messages.push({ role: 'assistant', content: blocks });

    // Execute each tool call and assemble tool_result blocks
    const toolResults = [];
    for (const tu of toolUseBlocks) {
      const result = await executeTool(tu.name, tu.input || {}, ctx);
      toolCallsLog.push({
        name: tu.name,
        input: tu.input,
        result_summary: result.error
          ? 'error:' + result.error
          : `ok:${result.count != null ? result.count + ' items' : (result.items ? result.items.length + ' items' : 'returned')}`,
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result).slice(0, 16000),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  // Outcome-learning log. Best-effort fire-and-forget; never blocks the
  // brain response. ctx may carry entity links (job_id, customer_id,
  // tech_id, signal_type, brain) — pass through whatever the caller
  // provided. The outcome linker walks back these rows when an outcome
  // signal (JOB_COMPLETED / CUSTOMER_FEEDBACK_RECEIVED / WARRANTY_*)
  // arrives later and attributes the outcome to the call.
  const userInput = typeof userContent === 'string' ? userContent : JSON.stringify(userContent).slice(0, 1000);
  // Self-reported confidence (if present in Claude's reply JSON).
  let confPct = 0;
  try {
    const parsed = tryParseJsonReply(finalText);
    if (parsed && parsed.parsed && parsed.captured && typeof parsed.captured.confidence === 'number') {
      confPct = Math.max(0, Math.min(100, Math.round(parsed.captured.confidence * 100)));
    }
  } catch (_) {}
  // #4 — compute cost from token usage (Anthropic per-MTok pricing)
  // and add it to the in-memory daily counter (#3 gate reads from
  // the same counter). claude_call_log gets the per-call cost so the
  // weekly digest can break down spend by brain.
  const costUsd = calcCallCost(model, totalTokensIn, totalTokensOut);
  const dailyTotalAfter = recordSpend(costUsd);

  // Emit an event_log row when daily spend crosses key thresholds (50%,
  // 80%, 100% of soft cap). Fire-and-forget. Lets the digest see how
  // spend ramps through the day.
  const softCap = Number(process.env.ANT_DAILY_SPEND_CAP_USD || 50);
  const before = dailyTotalAfter - costUsd;
  for (const pct of [0.5, 0.8, 1.0]) {
    const threshold = softCap * pct;
    if (before < threshold && dailyTotalAfter >= threshold) {
      try {
        fetch('https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/record_event_log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'claude_spend_threshold_crossed',
            metadata_json: JSON.stringify({
              pct, threshold_usd: threshold, today_usd: dailyTotalAfter,
              soft_cap_usd: softCap, crossed_at_ms: Date.now(),
            }),
          }),
        }).catch(() => {});
      } catch (_) {}
    }
  }

  _logCallAsync({
    company_id: ctx.company_id || 1,
    agent_name: ctx.brain || ctx.agent_name || 'brain',
    purpose: ctx.purpose || '',
    model,
    input_preview: userInput.slice(0, 1000),
    output_preview: (finalText || '').slice(0, 1000),
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    cost_usd: Math.round(costUsd * 1e6) / 1e6,
    outcome: '',
    source_signal_id: ctx.source_signal_id || 0,
    job_id: ctx.job_id || 0,
    customer_id: ctx.customer_id || 0,
    tech_id: ctx.tech_id || 0,
    signal_type: ctx.signal_type || '',
    brain: ctx.brain || '',
    tool_calls_count: toolCallsLog.length,
    confidence_pct: confPct,
  });

  return {
    reply: finalText,
    tool_calls: toolCallsLog,
    status: lastStatus,
    elapsed_ms: Date.now() - callStartedAt,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    cost_usd: costUsd,
    spend_gate: gate,
    confidence_pct: confPct,
  };
}

// Helper to parse JSON-formatted Claude responses (tech-side scribe uses
// this — Claude returns {"reply":"...","captured":{...}} and we extract
// both). Tolerant of markdown fences.
function tryParseJsonReply(rawText) {
  if (!rawText) return { reply: '', captured: {}, parsed: false };
  const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      reply: (parsed.reply || '').trim(),
      captured: parsed.captured || {},
      parsed: true,
    };
  } catch (_) {
    // The model didn't return PURE JSON — it wrote prose, or prose followed by
    // the {reply,captured} object. Returning `cleaned` here leaked the raw JSON
    // into the tech's text (Jimmy, 2026-06-30: "blowing me up with information"
    // + a literal {"reply":...,"captured":{...}} SMS). Extract the embedded JSON
    // object by brace-matching and use its reply; never send raw JSON.
    const start = cleaned.search(/\{\s*"reply"\s*:/);
    if (start >= 0) {
      let depth = 0, endIdx = -1;
      for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
      }
      if (endIdx > start) {
        try {
          const p = JSON.parse(cleaned.slice(start, endIdx + 1));
          return { reply: (p.reply || '').trim(), captured: p.captured || {}, parsed: true };
        } catch (_) { /* fall through to prose-only */ }
      }
      // Couldn't parse the JSON — send only the prose before it (strip the blob).
      return { reply: cleaned.slice(0, start).trim(), captured: {}, parsed: false };
    }
    return { reply: cleaned, captured: {}, parsed: false };
  }
}

module.exports = {
  runBrainTurn,
  tryParseJsonReply,
};
