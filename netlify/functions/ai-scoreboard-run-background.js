// ai-scoreboard-run-background — the heavy poller. Asks ChatGPT (OpenAI) + Claude
// (Anthropic), WITH LIVE WEB SEARCH, the money question per market ("best appliance
// repair company in {market}") and records whether TN Appliance Exchange is named,
// plus which competitors surfaced. Two models × five markets with web search would
// time out a sync fn, so this runs as a 15-min background function; the fast reader
// (ai-scoreboard.js) triggers it and polls the vault for the result.
//
// This is the REAL "does the AI recommend us" signal (vs. a Google-rank proxy) —
// both models search the live web, so the score reflects the current web state the
// AI-referral strategy is engineering. Best-effort throughout: a model that can't
// answer returns available:false and never a false "not recommended".
'use strict';

const { getSecret, setSecret } = require('./_lib/secrets');
const { askOpenAI, askAnthropic } = require('./_lib/ai-poll');

const STATE_KEY = 'AI_SCOREBOARD_STATE';
const MAX_HISTORY = 12;              // keep ~12 runs of trend
const PER_MODEL_TIMEOUT_MS = 55000;  // each web-search answer; well under the 15-min budget

// The three regions we're fighting for, as five real market queries.
const MARKETS = [
  { key: 'nashville', label: 'Nashville, Tennessee', region: 'Middle TN' },
  { key: 'murfreesboro', label: 'Murfreesboro, Tennessee', region: 'Middle TN' },
  { key: 'clarksville', label: 'Clarksville, Tennessee', region: 'Clarksville' },
  { key: 'baton_rouge', label: 'Baton Rouge, Louisiana', region: 'Louisiana' },
  { key: 'hammond', label: 'Hammond, Louisiana', region: 'Louisiana' },
];

function question(label) {
  return 'Who are the best appliance repair companies near ' + label + '? '
    + 'Please give your top 3-4 recommendations, with one sentence on each. '
    + 'Base it on current reviews and local reputation.';
}

exports.handler = async function () {
  const startedAt = Date.now();
  const results = [];

  for (const m of MARKETS) {
    const q = question(m.label);
    // Run both models for this market in parallel; each is best-effort.
    let chatgpt = { model: 'chatgpt', available: false, error: 'skipped' };
    let claude = { model: 'claude', available: false, error: 'skipped' };
    try {
      [chatgpt, claude] = await Promise.all([
        askOpenAI(q, PER_MODEL_TIMEOUT_MS).catch((e) => ({ model: 'chatgpt', available: false, error: String((e && e.message) || e) })),
        askAnthropic(q, PER_MODEL_TIMEOUT_MS).catch((e) => ({ model: 'claude', available: false, error: String((e && e.message) || e) })),
      ]);
    } catch (_) {}
    results.push({
      key: m.key, label: m.label, region: m.region,
      chatgpt: { available: !!chatgpt.available, mentioned: !!chatgpt.mentioned, competitors: chatgpt.competitors || [], answer: chatgpt.answer || '', error: chatgpt.error || '' },
      claude: { available: !!claude.available, mentioned: !!claude.mentioned, competitors: claude.competitors || [], answer: claude.answer || '', error: claude.error || '' },
    });
  }

  // Score: how many markets name us, per model (only counting markets the model could answer).
  const cgAnswered = results.filter((r) => r.chatgpt.available);
  const clAnswered = results.filter((r) => r.claude.available);
  const cgNamed = cgAnswered.filter((r) => r.chatgpt.mentioned).length;
  const clNamed = clAnswered.filter((r) => r.claude.mentioned).length;
  const totalNamed = cgNamed + clNamed;
  const totalAnswered = cgAnswered.length + clAnswered.length;

  const latest = {
    ran_at: startedAt,
    took_ms: Date.now() - startedAt,
    markets: results.length,
    chatgpt_named: cgNamed, chatgpt_answered: cgAnswered.length,
    claude_named: clNamed, claude_answered: clAnswered.length,
    score_named: totalNamed, score_of: totalAnswered,           // "we're named in N of M AI answers"
    pct: totalAnswered ? Math.round((totalNamed / totalAnswered) * 100) : 0,
    results,
  };

  // Persist: latest full detail + a compact trend history (drop the bulky answers from history).
  let prev = null;
  try { prev = JSON.parse((await getSecret(STATE_KEY)) || 'null'); } catch (_) {}
  const historyPoint = { ran_at: latest.ran_at, score_named: latest.score_named, score_of: latest.score_of, pct: latest.pct, chatgpt_named: cgNamed, claude_named: clNamed };
  const history = ([].concat((prev && prev.history) || [], [historyPoint])).slice(-MAX_HISTORY);

  try { await setSecret(STATE_KEY, JSON.stringify({ latest, history, generating_at: 0 })); } catch (_) {}

  return { statusCode: 200, body: JSON.stringify({ ok: true, pct: latest.pct, named: latest.score_named, of: latest.score_of }) };
};
