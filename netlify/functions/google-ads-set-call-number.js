// google-ads-set-call-number — set THE call number on the Google Ads account to
// a single number (default 615-845-8500, the "Google Ads" line → Ann the Closer).
//
// "Ads only" strategy (Teddy 2026-07-25): paid Google leads are cold new leads →
// route them to the Closer on a DEDICATED ads number, while the Business Profile,
// website, and citations stay on 615-280-2949 (general Ann) so local-SEO / NAP
// consistency is untouched. Call assets are independent of NAP, so this is the
// clean, best-practice split.
//
// It does a real SWAP, not just an add: it first REMOVES every existing CALL
// campaign-asset link (so an ad can never show two numbers — the trap with the
// old create-only add-buttons), then creates one call asset for the target number
// and links it to every non-removed SEARCH campaign.
//
//   GET ?secret=                 preview: show current call links + the plan
//   ...&apply=1                  do the swap
//   ...&phone=6158458500         (default = 615-845-8500; 10 digits OR +1XXXXXXXXXX)
//   ...&campaigns=ID,ID          (default = all non-removed SEARCH campaigns)
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// Normalize to E.164 US. Handles: "+16158458500", "16158458500", "6158458500",
// "(615) 845-8500". Fixes the add-buttons bug where a URL "+" (decoded to a space)
// left 11 digits and got "+1" prepended → "+116158458500".
function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') return '+' + d;
  if (d.length === 10) return '+1' + d;
  if (d.length >= 11) return '+' + d;
  return d ? '+1' + d : '';
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const phone = toE164(q.phone || '6158458500');
  if (!/^\+1\d{10}$/.test(phone)) return json(200, { ok: false, error: 'bad phone — pass 10 digits or +1XXXXXXXXXX', got: phone });
  const apply = q.apply === '1';

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;

  async function call(path, body) {
    let r, d;
    try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
    if (!r.ok && r.status === 403 && c.managerId) {
      try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); } catch (_) {}
    }
    const detail = d.error && d.error.details && d.error.details[0] && (d.error.details[0].errors || d.error.details[0]);
    return { ok: r.ok, status: r.status, d, err: r.ok ? null : { message: (d.error && d.error.message) || null, detail: detail || (d.error && d.error.status) || d } };
  }
  const query = (gaql) => call('/googleAds:search', { query: gaql });

  // 1) Current CALL campaign-asset links (what we'll remove), with the number on each.
  const curQ = await query("SELECT campaign_asset.resource_name, campaign_asset.campaign, campaign_asset.status, asset.call_asset.phone_number FROM campaign_asset WHERE campaign_asset.field_type = 'CALL' AND campaign_asset.status != 'REMOVED'");
  const curLinks = ((curQ.d && curQ.d.results) || []).map((r) => ({
    resource: r.campaignAsset && r.campaignAsset.resourceName,
    campaign: r.campaignAsset && r.campaignAsset.campaign,
    number: (r.asset && r.asset.callAsset && r.asset.callAsset.phoneNumber) || '',
  })).filter((x) => x.resource);

  // 2) Campaigns to link the new number to.
  let campaignIds = String(q.campaigns || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!campaignIds.length) {
    const cq = await query("SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.status != 'REMOVED' AND campaign.advertising_channel_type = 'SEARCH'");
    campaignIds = ((cq.d && cq.d.results) || []).map((r) => String(r.campaign && r.campaign.id)).filter(Boolean);
  }

  const plan = {
    target_number: phone,
    remove_existing_call_links: curLinks.map((l) => ({ number: l.number, campaign: l.campaign })),
    link_to_campaigns: campaignIds,
  };
  if (!apply) return json(200, { ok: true, mode: 'preview', cid, plan, note: 'add &apply=1 to remove the old call number(s) and attach ' + phone });

  // 3) Remove existing CALL links.
  let removed = { ok: true };
  if (curLinks.length) removed = await call('/campaignAssets:mutate', { partialFailure: true, operations: curLinks.map((l) => ({ remove: l.resource })) });

  // 4) Create the new call asset.
  const assetMut = await call('/assets:mutate', { operations: [{ create: { callAsset: { phoneNumber: phone, countryCode: 'US', callConversionReportingState: 'USE_ACCOUNT_LEVEL_CALL_CONVERSION_ACTION' } } }] });
  const callRes = assetMut.ok && assetMut.d.results && assetMut.d.results[0] ? assetMut.d.results[0].resourceName : null;

  // 5) Link the new asset to every target campaign.
  const links = [];
  if (callRes && campaignIds.length) {
    const ops = campaignIds.map((id) => ({ create: { campaign: `customers/${cid}/campaigns/${id}`, asset: callRes, fieldType: 'CALL' } }));
    const lm = await call('/campaignAssets:mutate', { partialFailure: true, operations: ops });
    links.push({ ok: lm.ok, linked: ops.length, err: lm.err });
  }

  return json(200, {
    ok: !!(callRes && (!campaignIds.length || links.every((l) => l.ok))),
    cid, target_number: phone,
    removed_old: { count: curLinks.length, ok: removed.ok, numbers: curLinks.map((l) => l.number), err: removed.err },
    new_call_asset: { ok: !!callRes, resource: callRes, err: assetMut.err },
    linked_campaigns: campaignIds, links,
  });
};
