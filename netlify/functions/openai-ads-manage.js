// openai-ads-manage — admin-gated campaign management for ChatGPT/OpenAI Ads:
// pause, resume, or archive a campaign by id (or a comma-separated list). Reuses the
// management key + connector. Read/list stays in openai-ads-performance; this is the
// small "clean up / turn off" tool the create+read suite was missing.
//
//   GET ?secret=<admin>&action=pause|resume|archive&id=<cmpn_...>[,<cmpn_...>]
//
// ⚠️ OpenAI Ads has NO delete — the terminal state is ARCHIVE, and archiving is
// IRREVERSIBLE (an archived campaign can't be resumed). So "archive" is the "get rid
// of it" action; pass it deliberately. pause/resume are reversible.
//
// Verbs (per developers.openai.com/ads — POST, never PATCH/PUT/DELETE, which 405):
//   pause   -> POST /campaigns/{id}/pause
//   resume  -> POST /campaigns/{id}   { status: "active" }
//   archive -> POST /campaigns/{id}/archive
//
// SAFETY: only touches the exact campaign ids you pass. Never bulk-selects. A resume
// (active) is the one spend-affecting action — pause/archive only ever REDUCE spend.
'use strict';
const { getSecret } = require('./_lib/secrets');
const oa = require('./_lib/openai-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const action = String(q.action || '').toLowerCase();
  if (!['pause', 'resume', 'archive'].includes(action)) {
    return json(400, { ok: false, error: 'action must be pause|resume|archive', example: '?secret=…&action=archive&id=cmpn_abc,cmpn_def' });
  }
  const ids = String(q.id || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return json(400, { ok: false, error: 'pass &id=<campaign id>[,<id>…]' });

  const c = await oa.creds();
  if (!c.key) return json(200, { ok: false, configured: false, error: 'OPENAI_ADS_API_KEY not vaulted' });

  const results = [];
  for (const id of ids) {
    const eid = encodeURIComponent(id);
    let res;
    if (action === 'pause') {
      res = await oa.api('POST', '/campaigns/' + eid + '/pause', c.key);
    } else if (action === 'archive') {
      res = await oa.api('POST', '/campaigns/' + eid + '/archive', c.key);
    } else {
      // resume = set status back to active (POST /campaigns/{id}, NOT PATCH/PUT)
      res = await oa.api('POST', '/campaigns/' + eid, c.key, { status: 'active' });
    }
    results.push({ id, ok: !!res.ok, status: res.status, error: res.ok ? null : res.err });
  }

  const note = action === 'resume'
    ? '⚠️ resumed campaign(s) are LIVE and spending.'
    : action === 'archive'
      ? '🗄️ archived — IRREVERSIBLE (OpenAI has no un-archive/delete). No spend added.'
      : 'paused — no spend added.';
  return json(200, { ok: results.every((r) => r.ok), action, count: results.length, results, note });
};
