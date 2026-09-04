// ai-poll — ask ChatGPT (OpenAI) + Claude (Anthropic) a question WITH LIVE WEB SEARCH and
// detect whether TN Appliance Exchange is named. This is the real "does the AI recommend us"
// signal (vs. a Google-rank proxy). Both models search the live web to answer, so the result
// reflects the current web state we're trying to influence. Best-effort: a model that can't
// answer (no key / web-search not enabled / timeout) returns { available:false } — never a
// false "not recommended".
'use strict';

// Keys resolve vault-first (env → Xano app_config), matching how embed-text/whisper read
// OPENAI_API_KEY — the key may live in the runtime vault, not process.env.
const { getSecret } = require('./secrets');
async function keyFor(name) { try { return (await getSecret(name)) || process.env[name] || ''; } catch (_) { return process.env[name] || ''; } }

// Brand match — tolerant of spacing/case ("TN Appliance Exchange", "tnapplianceexchange").
const BRAND_RE = /tn\s*appliance\s*exchange|tnapplianceexchange|\btn appliance\b/i;

// Local competitors we watch for context (not exhaustive; just to see who's beating us).
const COMPETITORS = ['Mr. Appliance', 'Hoffmann', 'Sears', 'Advance Appliance', 'Speedy',
  'Music City', 'Lee Company', 'Diamond Factory', 'A-1 Appliance', 'Appliance Doctor',
  'Cascade', 'Dixie Appliance', 'Authorized Appliance', 'Nesbit'];

function detectBrand(text) {
  const t = String(text || '');
  const comps = COMPETITORS.filter((c) => new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(t));
  return { mentioned: BRAND_RE.test(t), competitors: comps };
}

// ChatGPT — OpenAI Responses API with the built-in web_search tool.
async function askOpenAI(question, timeoutMs) {
  const key = await keyFor('OPENAI_API_KEY');
  if (!key) return { model: 'chatgpt', available: false, error: 'no OPENAI_API_KEY' };
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs || 45000);
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', tools: [{ type: 'web_search_preview' }], input: question }),
      signal: ac.signal,
    });
    clearTimeout(t);
    const d = await r.json().catch(() => null);
    if (!r.ok) return { model: 'chatgpt', available: false, error: ('http ' + r.status + ' ' + ((d && d.error && d.error.message) || '')).slice(0, 180) };
    let text = d && d.output_text ? d.output_text : '';
    if (!text && d && Array.isArray(d.output)) {
      for (const item of d.output) {
        if (item && Array.isArray(item.content)) {
          for (const c of item.content) { if (c && (c.type === 'output_text' || c.type === 'text') && c.text) text += c.text + '\n'; }
        }
      }
    }
    return Object.assign({ model: 'chatgpt', available: true, answer: String(text).slice(0, 1400) }, detectBrand(text));
  } catch (e) { clearTimeout(t); return { model: 'chatgpt', available: false, error: String((e && e.message) || e).slice(0, 140) }; }
}

// Claude — Anthropic Messages API with the built-in web_search tool.
async function askAnthropic(question, timeoutMs) {
  const key = await keyFor('ANTHROPIC_API_KEY');
  if (!key) return { model: 'claude', available: false, error: 'no ANTHROPIC_API_KEY' };
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs || 45000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929', max_tokens: 1024,
        messages: [{ role: 'user', content: question }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      }),
      signal: ac.signal,
    });
    clearTimeout(t);
    const d = await r.json().catch(() => null);
    if (!r.ok) return { model: 'claude', available: false, error: ('http ' + r.status + ' ' + ((d && d.error && d.error.message) || '')).slice(0, 180) };
    let text = '';
    if (d && Array.isArray(d.content)) { for (const b of d.content) { if (b && b.type === 'text' && b.text) text += b.text + '\n'; } }
    return Object.assign({ model: 'claude', available: true, answer: String(text).slice(0, 1400) }, detectBrand(text));
  } catch (e) { clearTimeout(t); return { model: 'claude', available: false, error: String((e && e.message) || e).slice(0, 140) }; }
}

module.exports = { askOpenAI, askAnthropic, detectBrand, BRAND_RE, COMPETITORS };
