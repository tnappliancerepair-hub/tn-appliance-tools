// google-ads-geo-presence — stop paying for people who are not here.
//
// The campaign runs PRESENCE_OR_INTEREST, which is Google's default and is the wrong
// setting for a trade that has to physically drive to the appliance. It serves the ad to
// anyone who merely MENTIONS a targeted place, anywhere on earth. The search-terms report
// is full of exactly that: paid clicks on "appliance repair clarksville tn",
// "appliance repair white house tn", "refrigerator repair columbia tn" — towns that are
// not in the nine cities this campaign targets.
//
// PRESENCE serves only people actually in the area. For appliance repair the customer is
// standing next to the broken machine, so presence is the honest match.
//
// PREVIEW BY DEFAULT. &apply=1 writes. Fully reversible — &revert=1 puts
// PRESENCE_OR_INTEREST back.
//   GET ?secret=<admin>[&campaign=<id>][&apply=1][&revert=1]
'use strict';

const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');

const DEFAULT_CAMPAIGN = '24154623729';   // After-Hours Appliance Repair — Nashville Metro
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'admin secret required (?secret=)' });

  const apply = q.apply === '1';
  const target = q.revert === '1' ? 'PRESENCE_OR_INTEREST' : 'PRESENCE';
  const campaignId = String(q.campaign || DEFAULT_CAMPAIGN).replace(/\D/g, '');
  if (!campaignId) return json(200, { ok: false, error: 'bad campaign id' });

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;

  async function call(path, body, login) {
    const r = await fetch(base + path, { method: 'POST', headers: ads.apiHeaders(token, c, login || cid), body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && r.status === 403 && c.managerId && !login) return call(path, body, c.managerId);
    return { ok: r.ok, status: r.status, d };
  }

  const cur = await call('/googleAds:search', { query: `SELECT campaign.id, campaign.name, campaign.status, campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type FROM campaign WHERE campaign.id = ${campaignId}` });
  const row = (cur.d.results || [])[0];
  if (!row) return json(200, { ok: false, error: 'campaign not found', campaign: campaignId, status: cur.status });
  const camp = row.campaign || {};
  const before = camp.geoTargetTypeSetting || {};

  const plan = {
    campaign: camp.name, id: campaignId, status: camp.status,
    positive_now: before.positiveGeoTargetType, positive_after: target,
    negative_now: before.negativeGeoTargetType,
  };
  if (before.positiveGeoTargetType === target) return json(200, { ok: true, already: true, mode: 'no-op', plan });
  if (!apply) return json(200, { ok: true, mode: 'preview', plan, note: 'add &apply=1 to write; &revert=1 restores PRESENCE_OR_INTEREST' });

  // partialFailure OFF, and verify the server acted on exactly as many operations as we
  // sent. A partial-failure mutate returns ok while silently dropping every operation —
  // that is how the ad schedule got wiped once before.
  const ops = [{
    update: { resourceName: `customers/${cid}/campaigns/${campaignId}`, geoTargetTypeSetting: { positiveGeoTargetType: target, negativeGeoTargetType: before.negativeGeoTargetType || 'PRESENCE' } },
    updateMask: 'geo_target_type_setting.positive_geo_target_type,geo_target_type_setting.negative_geo_target_type',
  }];
  const res = await call('/campaigns:mutate', { operations: ops, partialFailure: false });
  const applied = (res.d.results || []).length;
  if (!res.ok || applied !== ops.length) {
    return json(200, { ok: false, error: 'mutate did not apply', sent: ops.length, applied, status: res.status, detail: res.d.error || res.d });
  }

  // Prove it by reading the setting back, not by trusting the mutate response.
  const after = await call('/googleAds:search', { query: `SELECT campaign.geo_target_type_setting.positive_geo_target_type FROM campaign WHERE campaign.id = ${campaignId}` });
  const now = ((after.d.results || [])[0] || {}).campaign?.geoTargetTypeSetting?.positiveGeoTargetType;
  return json(200, { ok: now === target, mode: 'applied', plan, verified_now: now, note: now === target ? 'Serving only to people physically in the targeted cities.' : 'WRITE REPORTED OK BUT READ-BACK DISAGREES — check the account.' });
};
