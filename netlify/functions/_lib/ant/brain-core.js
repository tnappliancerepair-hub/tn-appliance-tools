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

const { executeTool } = require('./tools');

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
          system: systemPrompt,
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

  return { reply: finalText, tool_calls: toolCallsLog, status: lastStatus };
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
    return { reply: cleaned, captured: {}, parsed: false };
  }
}

module.exports = {
  runBrainTurn,
  tryParseJsonReply,
};
