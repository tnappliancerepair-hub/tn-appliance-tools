// servicepower-claims-test — owner-gated read-only test of the ServiceClaims
// Retrieval API. Proves the vaulted creds authenticate against the claims service
// and shows what a real claim record looks like (status + payment data).
//
//   GET /.netlify/functions/servicepower-claims-test?secret=<admin>
//        &call=<callNumber>            retrieve by dispatch call number
//        &claim=<claimNumber>          retrieve by claim number
//        &mfg=<manufacturerName>       manufacturerName (mandatory per spec — try a brand / client)
//        &svc=<serviceCenterNumber>    override service center (defaults to vaulted SvcrAcct)
//
// READ-ONLY. Never writes anything to ServicePower.
'use strict';

const claims = require('./_lib/servicepower-claims');
const { getSecret } = require('./_lib/secrets');

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — pass ?secret=' });

  if (!(await claims.isConfigured())) return json(200, { ok: false, error: 'ServicePower creds not in vault' });

  try {
    const res = await claims.retrieveClaims({
      callNumber: q.call || '',
      claimNumber: q.claim || '',
      manufacturerName: q.mfg || '',
      serviceCenterNumber: q.svc != null ? q.svc : undefined,
      claimBatchNumber: q.batch || 0,
      claimSequenceNumber: q.seq || 0,
    });
    return json(200, {
      ok: res.ok,
      env: (await claims.isProd()) ? 'production' : 'development',
      url: res.url,
      response_code: res.response_code,
      transaction_id: res.transaction_id,
      claim_count: res.claims.length,
      messages: res.messages,
      claims: res.claims.slice(0, 25),
      sent: res.sent,
      raw_preview: res.ok ? undefined : res.raw,
    });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
