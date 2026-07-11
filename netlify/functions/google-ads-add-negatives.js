// google-ads-add-negatives — adds campaign-level negative keywords to the two Ant
// repair campaigns so we stop paying for DIY researchers, parts-shoppers, used/buy
// intent, and job seekers. Learned from the search-terms report (2026-07-10): the
// clicks were going to "how to fix / troubleshooting / replace element" (DIYers)
// while the ready-to-hire "repair near me" searches got no click. Safe to run on
// paused campaigns — the negatives just sit ready for the next live test.
//   GET ?secret=<admin>[&dryrun=1]
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const CAMPAIGNS = ['23985730202', '23990301052']; // Dryer + Refrigerator (Ant)

// BROAD negatives: block a query if it contains these terms. Grouped by why.
const NEGATIVES = [
  // DIY / research intent (they fix it themselves, click and leave)
  'how to', 'troubleshooting', 'troubleshoot', 'diy', 'do it yourself', 'reset',
  'replacement', 'manual', 'wiring diagram', 'parts', 'youtube', 'tutorial', 'fix myself',
  // buy / used intent (protects against the used-store legacy)
  'used', 'for sale', 'buy', 'cheap', 'refurbished', 'scratch and dent', 'wholesale',
  // rentals, jobs, freebie/tire-kicker
  'rental', 'rent to own', 'job', 'hiring', 'salary', 'career', 'free', 'recall',
];

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const dry = q.dryrun === '1';

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const ver = c.version;
  const cid = ((await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121').replace(/\D/g, '');

  const operations = [];
  for (const camp of CAMPAIGNS) {
    for (const text of NEGATIVES) {
      operations.push({ create: { campaign: `customers/${cid}/campaigns/${camp}`, negative: true, keyword: { text, matchType: 'BROAD' } } });
    }
  }

  if (dry) return json(200, { ok: true, dry: true, cid, campaigns: CAMPAIGNS, negatives: NEGATIVES, total_ops: operations.length });

  const url = `https://googleads.googleapis.com/${ver}/customers/${cid}/campaignCriteria:mutate`;
  const body = { operations, partialFailure: true }; // partial: duplicates won't fail the batch
  let r, d;
  try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
  catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
  if (!r.ok && r.status === 403 && c.managerId) {
    try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); } catch (_) {}
  }
  if (!r.ok) return json(200, { ok: false, http: r.status, error: (d.error && (d.error.message || d.error.status)) || d });

  const added = (d.results || []).length;
  const partialErr = d.partialFailureError ? (d.partialFailureError.message || 'some existed/failed') : null;
  return json(200, { ok: true, cid, negatives_per_campaign: NEGATIVES.length, campaigns: CAMPAIGNS.length, added, partial: partialErr });
};
