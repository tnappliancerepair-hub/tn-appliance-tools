import { config } from './config.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Hard upper bound on a single Claude call. The Anthropic API normally
// returns in 2-20s; multi-minute hangs in the loop log have been observed
// when an HTTP connection goes half-dead. 60s is enough headroom for slow
// generation while bounding a single bad fetch to one tick window.
const CLAUDE_TIMEOUT_MS = 60 * 1000;

export async function callClaude({ system, messages, model = config.claudeModel, maxTokens = 2048, cacheSystem = true }) {
  if (config.dryRun) {
    return { content: [{ type: 'text', text: '{"likely_failure_mode":"DRY_RUN","parts_needed":[],"confidence_0_to_1":0.5,"customer_facing_summary":"dry run"}' }], usage: { input_tokens: 0, output_tokens: 0 } };
  }

  const body = {
    model,
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
    const err = new Error(`anthropic ${res.status}: ${txt.slice(0, 200)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
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
