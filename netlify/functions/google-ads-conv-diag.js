// google-ads-conv-diag — the definitive "why is my conversion tracking showing 0"
// check. Queries the ad account for (1) auto-tagging + conversion-tracking status,
// and (2) every conversion action with its status/category/recent counts. If
// auto-tagging is OFF, no gclid ever arrives and the whole offline-conversion loop
// is dead at the source. If the conversion actions are unverified / no-recent-conv,
// that's the other half.
//   GET ?secret=<admin>[&cid=9267688121]
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function gaql(ver, token, c, cid, query) {
  const url = `https://googleads.googleapis.com/${ver}/customers/${cid}/googleAds:search`;
  let r, d;
  try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify({ query }) }); d = await r.json().catch(() => ({})); }
  catch (e) { return { error: String(e.message || e) }; }
  if (!r.ok && r.status === 403 && c.managerId) {
    try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify({ query }) }); d = await r.json().catch(() => ({})); } catch (_) {}
  }
  if (!r.ok) return { http: r.status, error: (d.error && (d.error.message || d.error.status)) || d };
  return { results: d.results || [] };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const cid = String(q.cid || '9267688121').replace(/\D/g, '');
  const ver = 'v21';
  try {
    const c = await ads.creds();
    const token = await ads.accessToken(c);

    // 1) account-level settings
    const cust = await gaql(ver, token, c, cid,
      'SELECT customer.id, customer.descriptive_name, customer.auto_tagging_enabled, customer.conversion_tracking_setting.conversion_tracking_status, customer.conversion_tracking_setting.google_ads_conversion_customer FROM customer');

    // ?urls=1 — just the ads' final (landing) URLs per campaign, to confirm where
    // an ad click actually lands.
    if (q.urls === '1') {
      const ur = await gaql(ver, token, c, cid,
        "SELECT campaign.name, ad_group.name, ad_group_ad.ad.final_urls, ad_group_ad.status FROM ad_group_ad WHERE campaign.status = 'ENABLED' OR campaign.status = 'PAUSED'");
      const urls = (ur.results || []).map((x) => ({
        campaign: x.campaign && x.campaign.name,
        ad_status: x.adGroupAd && x.adGroupAd.status,
        final_urls: (x.adGroupAd && x.adGroupAd.ad && x.adGroupAd.ad.finalUrls) || [],
      }));
      return json(200, { ok: true, cid, ads: urls.length ? urls : ur });
    }

    // 2) every conversion action + its 30-day counts
    const acts = await gaql(ver, token, c, cid,
      "SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type, conversion_action.category, conversion_action.counting_type, metrics.all_conversions FROM conversion_action WHERE conversion_action.status != 'REMOVED'");

    const settings = (cust.results && cust.results[0] && cust.results[0].customer) || cust;
    const conv = settings.conversionTrackingSetting || {};
    const actions = (acts.results || []).map((x) => ({
      name: x.conversionAction && x.conversionAction.name,
      status: x.conversionAction && x.conversionAction.status,
      type: x.conversionAction && x.conversionAction.type,
      category: x.conversionAction && x.conversionAction.category,
      all_conversions: x.metrics ? Number(x.metrics.allConversions || 0) : 0,
    }));

    return json(200, {
      ok: true, cid,
      auto_tagging_enabled: settings.autoTaggingEnabled,
      conversion_tracking_status: conv.conversionTrackingStatus,
      conversion_owner_cid: conv.googleAdsConversionCustomer,
      conversion_actions: actions.length ? actions : acts,
    });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e) });
  }
};
