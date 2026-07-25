// google-ads-add-buttons — add the tappable extensions Teddy sees competitors
// have (Call + Sitelinks) to the live campaigns. Teddy 7/5: "add Call + Sitelink
// buttons via the API." On mobile these render as the Call button + the row of
// deep-links under the ad — the thing that made Hoffmann Brothers' ad look full
// and ours look like plain text.
//
// The Call number defaults to 615-845-8500 — the dedicated Google Ads line that
// rings Ann the Closer (Teddy 2026-07-25, "ads only": paid Google leads are cold
// new leads → the Closer). The Business Profile + website stay on 615-280-2949
// (general Ann) for NAP consistency. To do a clean SWAP (remove an old number
// first), use google-ads-set-call-number instead of re-running this.
//
// Location "Directions" extension is NOT done here: it needs the Google Business
// Profile linked as a location asset-set (a one-time Google Ads UI link). Once
// that link exists, location assets attach automatically account-wide. Reported
// in the response so it isn't silently skipped.
//
//   GET ?secret=                 preview: show what will be created, write nothing
//   ...&apply=1                  create the assets + link them to BOTH campaigns
//   ...&phone=+16152802949       (default shown)
//   ...&campaigns=23985730202,23990301052   (defaults = Dryer + Refrigerator)
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// The sitelinks — the deep-link row. linkText <=25 chars, each description <=35.
const SITELINKS = [
  { linkText: 'Book a Repair', description1: 'Same-week service, honest price', description2: 'We text you right back', finalUrls: ['https://tnapplianceexchange.net/appliance-ai.html'] },
  { linkText: 'Dryer Repair', description1: 'Not heating or spinning?', description2: 'Local dryer techs, fast', finalUrls: ['https://tnapplianceexchange.net/appliance-ai.html?appliance=dryer'] },
  { linkText: 'Refrigerator Repair', description1: 'Fridge not cooling?', description2: 'Same-week fridge service', finalUrls: ['https://tnapplianceexchange.net/appliance-ai.html?appliance=refrigerator'] },
  { linkText: 'Areas We Serve', description1: 'Smyrna, Murfreesboro,', description2: 'La Vergne, Antioch & nearby', finalUrls: ['https://tnapplianceexchange.net/service-area.html'] },
];

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  // Default = the Google Ads / Closer line. Robust normalize (a URL "+" decodes to
  // a space, so accept 10 digits, 11 with leading 1, or +1XXXXXXXXXX).
  const pd = String(q.phone || '6158458500').replace(/\D/g, '');
  const phone = pd.length === 11 && pd[0] === '1' ? '+' + pd : (pd.length === 10 ? '+1' + pd : (pd.length >= 11 ? '+' + pd : '+1' + pd));
  const campaignIds = String(q.campaigns || '23985730202,23990301052').split(',').map((s) => s.trim()).filter(Boolean);
  const apply = q.apply === '1';

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;

  async function post(path, body) {
    let r, d;
    try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
    if (!r.ok && r.status === 403 && c.managerId) {
      try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); } catch (_) {}
    }
    const detail = d.error && d.error.details && d.error.details[0] && (d.error.details[0].errors || d.error.details[0]);
    return { ok: r.ok, status: r.status, d, err: r.ok ? null : { message: (d.error && d.error.message) || null, detail: detail || (d.error && d.error.status) || d } };
  }

  const plan = {
    call: { phone, fieldType: 'CALL' },
    sitelinks: SITELINKS.map((s) => ({ text: s.linkText, url: s.finalUrls[0] })),
    campaigns: campaignIds,
    location_note: 'Directions/Location button needs the Google Business Profile linked as a location asset-set in Google Ads (Tools > Linked accounts > Business Profile). Once linked it attaches automatically — no API create.',
  };
  if (!apply) return json(200, { ok: true, mode: 'preview', cid, plan, note: 'add &apply=1 to create the Call + Sitelink assets and link them to every listed campaign' });

  // 1) Call asset.
  const callMut = await post('/assets:mutate', { operations: [{ create: { callAsset: { phoneNumber: phone, countryCode: 'US', callConversionReportingState: 'USE_ACCOUNT_LEVEL_CALL_CONVERSION_ACTION' } } }] });
  const callRes = callMut.ok && callMut.d.results && callMut.d.results[0] ? callMut.d.results[0].resourceName : null;

  // 2) Sitelink assets (one per link).
  const slMut = await post('/assets:mutate', { partialFailure: true, operations: SITELINKS.map((s) => ({ create: { finalUrls: s.finalUrls, sitelinkAsset: { linkText: s.linkText, description1: s.description1, description2: s.description2 } } })) });
  const slRes = (slMut.ok && slMut.d.results ? slMut.d.results : []).map((r) => r && r.resourceName).filter(Boolean);

  // 3) link every asset to every campaign.
  const links = [];
  for (const campId of campaignIds) {
    const campRes = `customers/${cid}/campaigns/${campId}`;
    const ops = [];
    if (callRes) ops.push({ create: { campaign: campRes, asset: callRes, fieldType: 'CALL' } });
    for (const s of slRes) ops.push({ create: { campaign: campRes, asset: s, fieldType: 'SITELINK' } });
    if (!ops.length) { links.push({ campaign: campId, ok: false, err: 'no assets created to link' }); continue; }
    const lm = await post('/campaignAssets:mutate', { partialFailure: true, operations: ops });
    links.push({ campaign: campId, ok: lm.ok, linked: ops.length, err: lm.err });
  }

  return json(200, {
    ok: !!(callRes && slRes.length && links.every((l) => l.ok)), cid,
    call: { ok: !!callRes, resource: callRes, phone, err: callMut.err },
    sitelinks: { ok: slRes.length === SITELINKS.length, count: slRes.length, err: slMut.err },
    links,
    location_note: plan.location_note,
  });
};
