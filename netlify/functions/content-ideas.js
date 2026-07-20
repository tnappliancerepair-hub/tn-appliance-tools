// content-ideas — owner-gated fast reader for the content-idea engine. Serves the
// cached weekly calendar instantly, and when it's stale/empty/refresh-requested it
// fires content-ideas-background (the heavy Claude generation, which a sync
// function would time out on) and returns generating:true so the page can poll.
//
//   GET ?secret=<VAPI_ADMIN_SECRET>[&refresh=1]
'use strict';

const { getSecret, getSecretFresh, setSecret } = require('./_lib/secrets');

const IDEAS_KEY = 'SOCIAL_CONTENT_IDEAS';
const FRESH_MS = 24 * 60 * 60 * 1000;    // a week's calendar; regen on demand
const GEN_LOCK_MS = 3 * 60 * 1000;       // don't double-trigger within 3 min

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  let cached = null;
  try { cached = JSON.parse((await getSecretFresh(IDEAS_KEY)) || 'null'); } catch (_) {}
  const now = Date.now();
  const hasIdeas = cached && Array.isArray(cached.ideas) && cached.ideas.length;
  const fresh = hasIdeas && cached.generated_at && (now - cached.generated_at) < FRESH_MS;
  const genInFlight = cached && cached.generating_at && (now - cached.generating_at) < GEN_LOCK_MS;
  const wantNew = q.refresh === '1' || !hasIdeas;

  if ((wantNew || !fresh) && !genInFlight) {
    // Mark generating, then invoke the background generator (returns 202 fast).
    try { await setSecret(IDEAS_KEY, JSON.stringify(Object.assign({}, cached || {}, { generating_at: now }))); } catch (_) {}
    const site = process.env.URL || process.env.DEPLOY_PRIME_URL || ('https://' + (event.headers && (event.headers.host || event.headers.Host) || 'tnapplianceexchange.net'));
    try { await fetch(`${site}/.netlify/functions/content-ideas-background?secret=${encodeURIComponent(q.secret)}`); } catch (_) {}
    return json(200, { ok: true, generating: true, ideas: (cached && cached.ideas) || [], corpus_size: (cached && cached.corpus_size) || 0, generated_at: (cached && cached.generated_at) || 0 });
  }

  return json(200, Object.assign({ ok: true, generating: !!genInFlight, cached: true }, cached || { ideas: [] }));
};
