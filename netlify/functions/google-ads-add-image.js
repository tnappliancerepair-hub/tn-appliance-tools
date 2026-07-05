// google-ads-add-image — attach the wrapped-truck photo as an image asset on the
// live campaigns. Teddy 7/5: this is the thumbnail that shows next to the ad on
// his phone (the thing competitors had and we didn't). Uploads a 1.91:1 landscape
// + 1:1 square crop of the Cybertruck wrap and links both to Dryer + Refrigerator.
//
// Reads the crops from the deployed site so the bytes travel with the deploy
// (no repo-file bundling needed):
//   /assets/marketing/truck-wrap-wide.jpg    (1200x628, 1.91:1)
//   /assets/marketing/truck-wrap-square.jpg  (1200x1200, 1:1)
//
//   GET ?secret=              preview (fetch the images, show sizes, write nothing)
//   ...&apply=1               create the image assets + link them to both campaigns
//   ...&campaigns=23985730202,23990301052   (defaults = Dryer + Refrigerator)
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const SITE = 'https://tnapplianceexchange.net';
const IMAGES = [
  { key: 'wide', url: SITE + '/assets/marketing/truck-wrap-wide.jpg', field: 'MARKETING_IMAGE', name: 'TN Truck Wrap 1.91x1' },
  { key: 'square', url: SITE + '/assets/marketing/truck-wrap-square.jpg', field: 'SQUARE_MARKETING_IMAGE', name: 'TN Truck Wrap 1x1' },
];

async function fetchB64(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('fetch ' + url + ' -> ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  return { b64: buf.toString('base64'), bytes: buf.length };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const campaignIds = String(q.campaigns || '23985730202,23990301052').split(',').map((s) => s.trim()).filter(Boolean);
  const apply = q.apply === '1';
  const stamp = q.stamp || String(Date.now());

  // fetch both crops (proves they're live before we write anything)
  let imgs;
  try { imgs = await Promise.all(IMAGES.map(async (im) => ({ ...im, ...(await fetchB64(im.url)) }))); }
  catch (e) { return json(200, { ok: false, step: 'fetch-images', error: String(e.message || e) }); }

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

  if (!apply) {
    return json(200, { ok: true, mode: 'preview', cid, campaigns: campaignIds, images: imgs.map((i) => ({ key: i.key, field: i.field, kb: Math.round(i.bytes / 1024) })), note: 'add &apply=1 to upload the image assets + link them to every listed campaign' });
  }

  // 1) create the image assets.
  const created = [];
  for (const im of imgs) {
    const mut = await post('/assets:mutate', { operations: [{ create: { name: `${im.name} ${stamp}`, imageAsset: { data: im.b64 } } }] });
    const res = mut.ok && mut.d.results && mut.d.results[0] ? mut.d.results[0].resourceName : null;
    created.push({ key: im.key, field: im.field, ok: mut.ok, resource: res, err: mut.err });
  }
  const good = created.filter((x) => x.resource);
  if (!good.length) return json(200, { ok: false, step: 'create-assets', created });

  // 2) link each image asset to each campaign.
  const links = [];
  for (const campId of campaignIds) {
    const campRes = `customers/${cid}/campaigns/${campId}`;
    const ops = good.map((g) => ({ create: { campaign: campRes, asset: g.resource, fieldType: g.field } }));
    const lm = await post('/campaignAssets:mutate', { partialFailure: true, operations: ops });
    links.push({ campaign: campId, ok: lm.ok, linked: ops.length, err: lm.err });
  }

  return json(200, { ok: !!(good.length && links.every((l) => l.ok)), cid, assets: created, links });
};
