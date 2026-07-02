// google-ads-setup-conversions — create the two conversion actions Ant uploads to,
// so Google can SEE which ad clicks became real out-of-pocket jobs (and their $ value).
//
// Our jobs/payments happen in OUR system, not on a web page, so we use OFFLINE click-
// conversion import: capture the gclid at intake, then upload the conversion when the
// job books / gets paid. These two actions are the targets for that upload:
//   • "Ant — Booked Job"  (a self-pay job got scheduled)        category SUBMIT_LEAD_FORM
//   • "Ant — Cash Paid"   (the customer actually paid, $ value) category PURCHASE
//
//   GET ?secret=<admin>[&cid=9267688121]        preview (writes nothing)
//   GET ?secret=<admin>&apply=1[&cid=...]       create them + vault their IDs
'use strict';
const { getSecret, setSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const ACTIONS = [
  { key: 'BOOKED', name: 'Ant — Booked Job', category: 'SUBMIT_LEAD_FORM', vault: 'GOOGLE_ADS_CONV_BOOKED' },
  { key: 'PAID', name: 'Ant — Cash Paid', category: 'PURCHASE', vault: 'GOOGLE_ADS_CONV_PAID' },
];

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const ver = c.version;
  const cid = String(q.cid || '9267688121').replace(/\D/g, '');   // the account running ads
  const apply = q.apply === '1';

  // LINK mode: the actions already exist (created earlier) but their IDs were
  // never vaulted, so uploads had no target. Look them up by name + vault them.
  if (q.link === '1') {
    const surl = `https://googleads.googleapis.com/${ver}/customers/${cid}/googleAds:search`;
    const gaql = 'SELECT conversion_action.resource_name, conversion_action.name, conversion_action.id FROM conversion_action';
    let r, d;
    try { r = await fetch(surl, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify({ query: gaql }) }); d = await r.json().catch(() => ({})); }
    catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
    if (!r.ok && r.status === 403 && c.managerId) {
      try { r = await fetch(surl, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify({ query: gaql }) }); d = await r.json().catch(() => ({})); } catch (_) {}
    }
    if (!r.ok) return json(200, { ok: false, http: r.status, error: (d.error && (d.error.message || d.error.status)) || d });
    const rows = d.results || [];
    const linked = {};
    for (const a of ACTIONS) {
      const hit = rows.find((x) => x.conversionAction && x.conversionAction.name === a.name);
      if (hit && hit.conversionAction.resourceName) {
        linked[a.key] = hit.conversionAction.resourceName;
        try { await setSecret(a.vault, hit.conversionAction.resourceName); } catch (_) {}
        try { await setSecret(a.vault + '_ID', String(hit.conversionAction.id)); } catch (_) {}
      }
    }
    try { await setSecret('GOOGLE_ADS_CONV_CID', cid); } catch (_) {}
    return json(200, { ok: Object.keys(linked).length === ACTIONS.length, mode: 'linked', cid, linked, actions_in_account: rows.length });
  }

  // each conversion action: UPLOAD_CLICKS (offline import) + value-based (use the $ we send)
  const plan = ACTIONS.map((a) => ({
    create: {
      name: a.name,
      type: 'UPLOAD_CLICKS',
      category: a.category,
      status: 'ENABLED',
      countingType: 'ONE_PER_CLICK',
      valueSettings: { defaultValue: 0, alwaysUseDefaultValue: false },
    },
  }));

  if (!apply) return json(200, { ok: true, mode: 'preview', cid, would_create: ACTIONS.map((a) => a.name), note: 'add &apply=1 to create them' });

  // create them, trying the account directly then via the manager (cross-account)
  const url = `https://googleads.googleapis.com/${ver}/customers/${cid}/conversionActions:mutate`;
  const body = JSON.stringify({ operations: plan });
  let r, d;
  try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body }); d = await r.json().catch(() => ({})); }
  catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
  if (!r.ok && r.status === 403 && c.managerId) {
    try { r = await fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body }); d = await r.json().catch(() => ({})); } catch (_) {}
  }
  if (!r.ok) return json(200, { ok: false, http: r.status, error: (d.error && (d.error.message || d.error.status)) || d, detail: (d.error && d.error.details && d.error.details[0] && d.error.details[0].errors) || null });

  // results[] line up with operations[]; resourceName = customers/{cid}/conversionActions/{id}
  const results = (d.results || []).map((x) => x.resourceName);
  const saved = {};
  for (let i = 0; i < ACTIONS.length; i++) {
    const rn = results[i];
    if (!rn) continue;
    saved[ACTIONS[i].key] = rn;
    try { await setSecret(ACTIONS[i].vault, rn); } catch (_) {}
    try { await setSecret(ACTIONS[i].vault + '_ID', rn.split('/').pop()); } catch (_) {}
  }
  // remember which account holds them (uploads must target the same cid)
  try { await setSecret('GOOGLE_ADS_CONV_CID', cid); } catch (_) {}

  return json(200, { ok: true, mode: 'applied', cid, created: saved, count: results.length });
};
