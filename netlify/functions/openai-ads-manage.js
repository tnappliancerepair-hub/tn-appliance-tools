// openai-ads-manage — admin-gated campaign management for ChatGPT/OpenAI Ads:
// pause, resume, or delete a campaign by id (or a comma-separated list). Reuses the
// management key + connector. Read/list stays in openai-ads-performance; this is the
// small "clean up / turn off" tool the create+read suite was missing.
//
//   GET ?secret=<admin>&action=pause|resume|delete&id=<cmpn_...>[,<cmpn_...>]
//
// SAFETY: only touches the exact campaign ids you pass. Never bulk-selects. A resume
// (active) is the one spend-affecting action — pause/delete only ever REDUCE spend.
'use strict';
const { getSecret } = require('./_lib/secrets');
const oa = require('./_lib/openai-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const action = String(q.action || '').toLowerCase();
  if (!['pause', 'resume', 'delete'].includes(action)) {
    return json(400, { ok: false, error: 'action must be pause|resume|delete', example: '?secret=…&action=delete&id=cmpn_abc,cmpn_def' });
  }
  const ids = String(q.id || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return json(400, { ok: false, error: 'pass &id=<campaign id>[,<id>…]' });

  const c = await oa.creds();
  if (!c.key) return json(200, { ok: false, configured: false, error: 'OPENAI_ADS_API_KEY not vaulted' });

  const results = [];
  for (const id of ids) {
    let res;
    if (action === 'delete') {
      res = await oa.api('DELETE', '/campaigns/' + encodeURIComponent(id), c.key);
    } else {
      // pause = 'paused'; resume = 'active'
      res = await oa.api('PATCH', '/campaigns/' + encodeURIComponent(id), c.key, { status: action === 'resume' ? 'active' : 'paused' });
    }
    results.push({ id, ok: !!res.ok, status: res.status, error: res.ok ? null : res.err });
  }
  return json(200, {
    ok: results.every((r) => r.ok), action, count: results.length, results,
    note: action === 'resume' ? '⚠️ resumed campaign(s) are LIVE and spending.' : 'no spend added (pause/delete only reduce spend).',
  });
};
