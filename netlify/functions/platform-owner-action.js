// platform-owner-action — the human-UI door to the reversible action ledger.
// Thin wrapper over _lib/owner-actions (the ONE intent engine the Ant brain also uses).
//
//   POST ?do=apply   { access_token, intent, args, via?, reason? }  -> { ok, action_id, label, before, after }
//   POST ?do=undo    { access_token, action_id }                    -> { ok, action_id, label }
//   POST ?do=list    { access_token, limit? }                       -> { ok, actions:[...] }
//   POST ?do=intents { access_token }                               -> { ok, intents:[...] }
'use strict';

const OA = require('./_lib/owner-actions');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  const q = event.queryStringParameters || {};
  const doAction = String(q.do || 'apply');
  let p = {}; try { p = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'bad json' }); }

  const caller = await OA.resolveCaller(String(p.access_token || '').trim());
  if (caller.error) return json(caller.error === 'not signed in' ? 401 : 403, { ok: false, error: caller.error });
  if (!OA.MGMT.includes(caller.role)) return json(403, { ok: false, error: 'role not allowed', role: caller.role });
  const ctx = { d: caller.d, companyId: caller.companyId, role: caller.role };

  try {
    if (doAction === 'intents') return json(200, { ok: true, intents: OA.INTENTS_META });
    if (doAction === 'list') return json(200, await OA.listActions(ctx, p.limit));
    if (doAction === 'apply') {
      if (!OA.INTENTS[String(p.intent || '')]) return json(400, { ok: false, error: 'unknown intent: ' + p.intent });
      return json(200, await OA.applyIntent(ctx, String(p.intent), p.args || {}, { via: p.via, reason: p.reason }));
    }
    if (doAction === 'undo') return json(200, await OA.undoAction(ctx, String(p.action_id || '')));
    return json(400, { ok: false, error: 'unknown do: ' + doAction });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
