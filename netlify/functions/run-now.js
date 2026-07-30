// run-now — owner-gated on-demand runner for SCHEDULED functions.
//
// Netlify now blocks direct HTTP to any function declared with `schedule=` in
// netlify.toml (403 at the edge — the cron still fires, but "pull it now" URLs are
// dead). This one NON-scheduled function receives the HTTP request fine, then
// invokes the target function's handler IN-PROCESS (require + call), skipping the
// blocked HTTP endpoint. So every scheduled report/watcher gets its on-demand path
// back through a single door, with no per-function work.
//
//   GET/POST  ?secret=<admin>&fn=<scheduled-fn-name>[&any=extra&params=here]
//     - `fn` must be a real function file (a-z 0-9 _ -), not run-now itself.
//     - All other query params + the request body are forwarded to the target, and
//       the admin secret + a next_run marker are injected so the target's own auth
//       (secret-path OR cron-path) passes.
//
// Note: run-now is a SYNC function (~10s Netlify cap). Heavy 15-min background
// jobs will time out here — use their own -background trigger for those.
'use strict';
const fs = require('fs');
const path = require('path');
const { getSecret } = require('./_lib/secrets');

function json(code, body) { return { statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const fn = String(q.fn || '').trim();
  if (!fn) return json(400, { ok: false, error: 'pass ?fn=<scheduled-function-name>' });
  if (!/^[a-z0-9_-]+$/.test(fn) || fn === 'run-now') return json(400, { ok: false, error: 'invalid fn' });

  const file = path.join(__dirname, fn + '.js');
  if (!fs.existsSync(file)) return json(404, { ok: false, error: 'no such function: ' + fn });

  let mod;
  try { mod = require(file); } catch (e) { return json(500, { ok: false, error: 'load failed: ' + String((e && e.message) || e) }); }
  if (!mod || typeof mod.handler !== 'function') return json(500, { ok: false, error: fn + ' has no handler' });

  // Forward everything except our own control params; inject secret + next_run so
  // the target self-authorizes whether it uses a secret-path or a cron-path.
  const fwdQuery = Object.assign({}, q);
  delete fwdQuery.fn;
  fwdQuery.secret = admin;
  let fwdBody = event.body && event.body.trim() ? event.body : '';
  if (!fwdBody) { try { fwdBody = JSON.stringify(Object.assign({ next_run: true }, fwdQuery)); } catch (_) { fwdBody = '{"next_run":true}'; } }

  const synthetic = {
    httpMethod: event.httpMethod || 'POST',
    queryStringParameters: fwdQuery,
    headers: event.headers || {},
    body: fwdBody,
  };

  const started = Date.now();
  try {
    const res = await mod.handler(synthetic, {});
    let parsed = res && res.body;
    try { parsed = JSON.parse(res.body); } catch (_) {}
    return json(200, { ok: true, ran: fn, target_status: (res && res.statusCode) || null, ms: Date.now() - started, result: parsed });
  } catch (e) {
    return json(200, { ok: false, ran: fn, ms: Date.now() - started, error: String((e && e.message) || e) });
  }
};
