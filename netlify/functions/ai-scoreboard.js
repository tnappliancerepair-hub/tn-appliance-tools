// ai-scoreboard — owner-gated fast reader for the AI Scoreboard. Returns the stored
// state (latest per-market ChatGPT/Claude verdicts + trend) instantly. With ?run=1 it
// fires the heavy background poller (ai-scoreboard-run-background) — which actually asks
// both models with live web search — and returns generating:true so the page can poll.
//
//   GET ?secret=<VAPI_ADMIN_SECRET>          -> stored state
//   GET ?secret=<VAPI_ADMIN_SECRET>&run=1    -> kick a fresh poll, return generating
'use strict';

const { getSecret, setSecret } = require('./_lib/secrets');

const STATE_KEY = 'AI_SCOREBOARD_STATE';
const GEN_LOCK_MS = 6 * 60 * 1000;   // a two-model x five-market web-search run takes a few min

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  let state = null;
  try { state = JSON.parse((await getSecret(STATE_KEY)) || 'null'); } catch (_) {}
  const now = Date.now();
  const genInFlight = state && state.generating_at && (now - state.generating_at) < GEN_LOCK_MS;

  if (q.run === '1' && !genInFlight) {
    try { await setSecret(STATE_KEY, JSON.stringify(Object.assign({}, state || {}, { generating_at: now }))); } catch (_) {}
    const site = process.env.URL || process.env.DEPLOY_PRIME_URL || ('https://' + ((event.headers && (event.headers.host || event.headers.Host)) || 'tnapplianceexchange.net'));
    // Fire-and-forget the background runner (returns 202 immediately).
    try { await fetch(`${site}/.netlify/functions/ai-scoreboard-run-background`); } catch (_) {}
    return json(200, { ok: true, generating: true, latest: (state && state.latest) || null, history: (state && state.history) || [] });
  }

  return json(200, { ok: true, generating: !!genInFlight, latest: (state && state.latest) || null, history: (state && state.history) || [] });
};
