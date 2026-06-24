// servicepower-test — owner-gated diagnostic. Calls SPDService getTestService to
// verify connectivity (and, once creds are vaulted, that they're accepted) WITHOUT
// modifying any work order. No secrets leaked.
//   GET /.netlify/functions/servicepower-test?secret=<admin>&env=development|production
'use strict';
const { getSecret } = require('./_lib/secrets');
const sp = require('./_lib/servicepower');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const adminSecret = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== adminSecret) return json(401, { ok: false, error: 'admin secret required (?secret=)' });

  const configured = await sp.isConfigured();
  const op = (q.op || 'read').toLowerCase();   // 'read' = getCallInfo (validates creds); 'ping' = getTestService

  // date window for getCallInfo (mm/dd/yyyy HH:mm:ss) — default last 14 days
  function fmt(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  const now = Date.now();
  const from = q.from || fmt(new Date(now - 14 * 86400000));
  const to = q.to || fmt(new Date(now));

  let r = {};
  try {
    r = op === 'ping' ? await sp.getTestService('ant-connectivity-check')
                      : await sp.getCallInfo({ fromDateTime: from, toDateTime: to });
  } catch (e) { return json(200, { ok: false, configured, op, error: String((e && e.message) || e) }); }

  // detect an auth failure in the SOAP fault text
  const raw = (r.raw || '');
  const looksAuth = /invalid|unauthor|authentic|password|user\s*id|credential|access denied|not\s*valid/i.test(raw);
  return json(200, {
    ok: r.ok,
    configured,
    op,
    service_url: await sp.serviceUrl(),
    soap_status: r.status,
    fault: r.fault,
    fault_string: r.fault_string,
    call_statuses_seen: r.call_statuses_seen,
    window: { from, to },
    likely_auth_issue: !r.ok && looksAuth,
    detail: raw.slice(0, 400),
    note: r.ok ? 'AUTH OK — getCallInfo returned. Real status codes in call_statuses_seen.'
               : (looksAuth ? 'Looks like a credentials problem — reset/verify the password.' : 'Inspect detail (could be no jobs in window, or a request-shape tweak).'),
  });
};
