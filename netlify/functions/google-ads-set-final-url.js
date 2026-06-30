// google-ads-set-final-url — point the Ant campaigns' ads at the clean AI intake
// page (/appliance-ai.html) instead of the bare domain (/). Teddy's call
// (2026-06-30): ads should land on the AI page; the homepage / stays the content
// page so Google's site reviewer still sees a full business website.
// Updates the ad's final_urls in place (URL fields are mutable — no ad rebuild).
//   GET ?secret=&dryrun=1            show current vs new (no change)
//   GET ?secret=                     apply to the 2 Ant campaigns
//   ...&campaigns=ID,ID              override which campaigns
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// move a bare-domain final URL onto the AI page, preserving the ?appliance= query
function toAiPage(u) {
  if (!u) return u;
  if (u.includes('/appliance-ai.html')) return u; // already there
  return u
    .replace('tnapplianceexchange.net/?', 'tnapplianceexchange.net/appliance-ai.html?')
    .replace(/tnapplianceexchange\.net\/?$/, 'tnapplianceexchange.net/appliance-ai.html');
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const camps = String(q.campaigns || '23985730202,23990301052').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean);
  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;

  async function api(path, body) {
    let r, d;
    try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
    if (!r.ok && r.status === 403 && c.managerId) {
      try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); } catch (_) {}
    }
    return { ok: r.ok, status: r.status, d, err: r.ok ? null : ((d.error && d.error.message) || d) };
  }

  // find the ads + their current final URLs in those campaigns
  const gaql = `SELECT ad_group_ad.ad.resource_name, ad_group_ad.ad.final_urls, campaign.id, campaign.name FROM ad_group_ad WHERE campaign.id IN (${camps.join(',')})`;
  const search = await api('/googleAds:search', { query: gaql });
  if (!search.ok) return json(200, { ok: false, step: 'search', error: search.err });

  const rows = (search.d.results || []).map((r) => ({
    resource: r.adGroupAd.ad.resourceName,
    campaign: r.campaign && r.campaign.name,
    current: (r.adGroupAd.ad.finalUrls || []),
    next: (r.adGroupAd.ad.finalUrls || []).map(toAiPage),
  }));
  const changed = rows.filter((x) => JSON.stringify(x.current) !== JSON.stringify(x.next));

  if (q.dryrun === '1') return json(200, { ok: true, dryrun: true, cid, campaigns: camps, ads: rows });
  if (!changed.length) return json(200, { ok: true, note: 'nothing to change (already on the AI page)', ads: rows });

  const mut = await api('/ads:mutate', {
    operations: changed.map((x) => ({ update: { resourceName: x.resource, finalUrls: x.next }, updateMask: 'final_urls' })),
  });
  return json(200, { ok: mut.ok, updated: changed.map((x) => ({ campaign: x.campaign, from: x.current, to: x.next })), error: mut.err });
};
