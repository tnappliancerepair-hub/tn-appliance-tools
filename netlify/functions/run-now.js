// run-now — owner-gated on-demand runner for SCHEDULED functions.
//
// Netlify blocks direct HTTP to any function declared with `schedule=` in
// netlify.toml (403 at the edge — the cron still fires, but "pull it now" URLs are
// dead). This NON-scheduled function receives the request fine, then invokes the
// target's handler IN-PROCESS, skipping the blocked HTTP endpoint.
//
// Netlify bundles each function separately, so the targets must be STATICALLY
// required here (esbuild then bundles them into run-now). This map covers the
// owner-facing reports/tools that are actually pulled on demand — add a line to
// extend it. Pure background watchers don't need this (their cron still runs).
//
//   GET/POST ?secret=<admin>&fn=<name>[&extra=params]   (or ?list=1 to see names)
'use strict';
const { getSecret } = require('./_lib/secrets');

// name -> module. Static requires so Netlify bundles each target into run-now.
const TARGETS = {
  'markets-report': require('./markets-report'),
  'scorecard-digest': require('./scorecard-digest'),
  'phone-trust-scorecard': require('./phone-trust-scorecard'),
  'phone-accuracy-audit': require('./phone-accuracy-audit'),
  'office-daily-recap': require('./office-daily-recap'),
  'office-morning-briefing': require('./office-morning-briefing'),
  'office-action-digest': require('./office-action-digest'),
  'gsc-weekly-report': require('./gsc-weekly-report'),
  'site-health-sweep': require('./site-health-sweep'),
  'ant-brain-sweep': require('./ant-brain-sweep'),
  'boss-trash-talk': require('./boss-trash-talk'),
  'tdr-gap-watch': require('./tdr-gap-watch'),
  'parts-arrival-watch': require('./parts-arrival-watch'),
  'payout-ready-notify': require('./payout-ready-notify'),
};

function json(code, body) { return { statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  if (q.list === '1' || !q.fn) return json(200, { ok: true, note: 'pull a scheduled fn on demand: ?secret=&fn=<name>', available: Object.keys(TARGETS).sort() });

  const fn = String(q.fn || '').trim();
  const mod = TARGETS[fn];
  if (!mod) return json(404, { ok: false, error: 'not runnable via run-now: ' + fn, available: Object.keys(TARGETS).sort() });
  if (typeof mod.handler !== 'function') return json(500, { ok: false, error: fn + ' has no handler' });

  // Forward query (minus fn) + inject secret + next_run so the target self-authorizes
  // whether it uses a secret-path or a cron-path.
  const fwdQuery = Object.assign({}, q); delete fwdQuery.fn; fwdQuery.secret = admin;
  let fwdBody = (event.body && event.body.trim()) ? event.body : '';
  if (!fwdBody) { try { fwdBody = JSON.stringify(Object.assign({ next_run: true }, fwdQuery)); } catch (_) { fwdBody = '{"next_run":true}'; } }
  const synthetic = { httpMethod: event.httpMethod || 'POST', queryStringParameters: fwdQuery, headers: event.headers || {}, body: fwdBody };

  const started = Date.now();
  try {
    const res = await mod.handler(synthetic, {});
    let parsed = res && res.body; try { parsed = JSON.parse(res.body); } catch (_) {}
    return json(200, { ok: true, ran: fn, target_status: (res && res.statusCode) || null, ms: Date.now() - started, result: parsed });
  } catch (e) {
    return json(200, { ok: false, ran: fn, ms: Date.now() - started, error: String((e && e.message) || e) });
  }
};
