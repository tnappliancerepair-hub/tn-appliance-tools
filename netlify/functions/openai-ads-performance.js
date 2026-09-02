// openai-ads-performance — pulls ChatGPT Ads spend/results so we can see if the
// budget is buying jobs or burning. Reads account-level insights, then per-campaign.
// DARK: returns { configured:false } until OPENAI_ADS_API_KEY is vaulted.
//
//   GET ?secret=<admin>[&days=30][&campaign=<id>]
'use strict';
const { getSecret } = require('./_lib/secrets');
const oa = require('./_lib/openai-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const days = Math.max(1, Math.min(365, parseInt(q.days, 10) || 30));

  const c = await oa.creds();
  if (!c.key) return json(200, { ok: false, configured: false });

  // account first
  const acct = await oa.api('GET', '/ad_account', c.key);
  if (!acct.ok) return json(200, { ok: false, configured: false, error: acct.err });

  // insights — scope to a campaign if given, else account. Field names for the
  // date window get confirmed on the first real call; we pass a documented range.
  const qs = `?date_range=LAST_${days}_DAYS`;
  const path = q.campaign ? `/campaigns/${String(q.campaign).replace(/[^\w-]/g, '')}/insights${qs}` : `/ad_account/insights${qs}`;
  const ins = await oa.api('GET', path, c.key);

  // campaign list (best-effort — helps see what's running)
  const camps = await oa.api('GET', '/campaigns', c.key);

  return json(200, {
    ok: true, configured: true, days,
    account: acct.d && (acct.d.ad_account || acct.d),
    insights: ins.ok ? (ins.d && (ins.d.insights || ins.d)) : { error: ins.err },
    campaigns: camps.ok ? (camps.d && (camps.d.campaigns || camps.d)) : { error: camps.err },
  });
};
