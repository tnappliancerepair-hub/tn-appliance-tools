import { config } from './config.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Hard upper bound on a single Claude call. The Anthropic API normally
// returns in 2-20s; multi-minute hangs in the loop log have been observed
// when an HTTP connection goes half-dead. 60s is enough headroom for slow
// generation while bounding a single bad fetch to one tick window.
const CLAUDE_TIMEOUT_MS = 60 * 1000;

// Model tier shorthand. Agents can pass `model: 'haiku'` (or 'fast') to
// cut spend ~80% on cheap-decision work (intent classification, single-
// field extraction, yes/no routing). Default stays Sonnet for back-compat.
//
// Pricing baked into COST_TABLE below — update both when Anthropic
// changes published rates.
const MODEL_TIERS = {
  haiku:  'claude-haiku-4-5-20251001',
  fast:   'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  smart:  'claude-sonnet-4-6',
  opus:   'claude-opus-4-7',
  best:   'claude-opus-4-7',
};

// $ per 1M tokens. Used for cost_usd column + daily watchdog totals.
// Cache-read pricing is ~10% of input; we conservatively bill cached
// tokens at the full input rate. Refine when we have cache visibility.
const COST_TABLE = {
  'claude-haiku-4-5-20251001':  { in: 1.00,  out: 5.00  },
  'claude-haiku-4-5':           { in: 1.00,  out: 5.00  },
  'claude-sonnet-4-6':          { in: 3.00,  out: 15.00 },
  'claude-opus-4-7':            { in: 15.00, out: 75.00 },
};

function resolveModel(m) {
  if (!m) return config.claudeModel;
  const key = String(m).toLowerCase();
  return MODEL_TIERS[key] || m;
}

function costFor(model, tokensIn, tokensOut) {
  // Match by exact ID first, then any prefix.
  const rates = COST_TABLE[model] || Object.entries(COST_TABLE).find(([k]) => model.startsWith(k))?.[1];
  if (!rates) return 0;
  return (Number(tokensIn || 0) * rates.in + Number(tokensOut || 0) * rates.out) / 1_000_000;
}

export async function callClaude({
  system,
  messages,
  model = config.claudeModel,
  maxTokens = 2048,
  cacheSystem = true,
  // Optional logging metadata — encouraged on every call. Defaults make
  // the call still work for legacy invocations that omit these.
  agentName = '',
  purpose = '',
  sourceSignalId = 0,
}) {
  const resolvedModel = resolveModel(model);

  if (config.dryRun) {
    // Log the dry-run too so we can audit what WOULD have been called.
    fireAndForgetLog({
      agent_name: agentName,
      purpose,
      model: resolvedModel,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      outcome: 'dry_run',
      source_signal_id: sourceSignalId,
      input_preview: previewFromMessages(messages),
      output_preview: '',
    });
    return { content: [{ type: 'text', text: '{"likely_failure_mode":"DRY_RUN","parts_needed":[],"confidence_0_to_1":0.5,"customer_facing_summary":"dry run"}' }], usage: { input_tokens: 0, output_tokens: 0 } };
  }

  const body = {
    model: resolvedModel,
    max_tokens: maxTokens,
    messages,
  };
  if (system) {
    body.system = cacheSystem
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);
  let res;
  const callStartedAt = Date.now();
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    fireAndForgetLog({
      agent_name: agentName,
      purpose,
      model: resolvedModel,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      outcome: (err && err.name === 'AbortError') ? 'timeout' : 'fetch_error',
      source_signal_id: sourceSignalId,
      input_preview: previewFromMessages(messages),
      output_preview: String(err.message || err).slice(0, 200),
    });
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      throw new Error(`anthropic call timed out after ${CLAUDE_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  if (!res.ok) {
    fireAndForgetLog({
      agent_name: agentName,
      purpose,
      model: resolvedModel,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      outcome: `http_${res.status}`,
      source_signal_id: sourceSignalId,
      input_preview: previewFromMessages(messages),
      output_preview: txt.slice(0, 200),
    });
    const err = new Error(`anthropic ${res.status}: ${txt.slice(0, 200)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  const usage = data.usage || {};
  const tokensIn  = Number(usage.input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0) + Number(usage.cache_read_input_tokens || 0);
  const tokensOut = Number(usage.output_tokens || 0);
  const cost      = costFor(resolvedModel, tokensIn, tokensOut);
  const outputText = textFromResponse(data);

  fireAndForgetLog({
    agent_name: agentName,
    purpose,
    model: resolvedModel,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: cost,
    outcome: 'ok',
    source_signal_id: sourceSignalId,
    input_preview: previewFromMessages(messages),
    output_preview: (outputText || '').slice(0, 400),
  });

  return data;
}

// Background log helper. Never blocks the caller and never throws —
// if the audit POST fails (network blip, Xano hiccup), we lose ONE
// row of audit data, not a real Claude call.
function fireAndForgetLog(payload) {
  if (!config.recordClaudeCallEndpoint) return;
  try {
    fetch(config.recordClaudeCallEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (_) {}
}

function previewFromMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const last = messages[messages.length - 1];
  const content = last?.content;
  if (typeof content === 'string') return content.slice(0, 400);
  if (Array.isArray(content)) {
    const firstText = content.find((b) => b && b.type === 'text' && b.text);
    if (firstText) return firstText.text.slice(0, 400);
  }
  return '';
}

export function textFromResponse(resp) {
  const blocks = resp?.content || [];
  for (const b of blocks) {
    if (b.type === 'text' && b.text) return b.text;
  }
  return '';
}

export function stripFences(raw) {
  if (!raw) return '';
  return raw.replace(/```json/g, '').replace(/```/g, '').trim();
}
