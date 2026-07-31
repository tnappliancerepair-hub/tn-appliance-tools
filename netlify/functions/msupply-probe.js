// msupply-probe — owner-gated one-off: does Marcone/mSupply expose MODEL -> PARTS?
// The clean API's /parts/lookup is part#-first; the spec also lists
// /parts/productlistlookup with an undocumented body. This tries that endpoint
// (and a couple of variants) with a real model number in several likely field
// shapes and reports what comes back — so we learn the correct request shape in
// one deploy. Values are structural only (no secrets printed).
//   GET ?secret=<admin>&model=WTW5000DW2[&make=WPL]
'use strict';
const msupply = require('./_lib/msupply');
const { getSecret } = require('./_lib/secrets');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const model = String(q.model || 'WTW5000DW2').trim();
  const make = q.make ? String(q.make).trim() : undefined;
  const custNo = (await getSecret('MSUPPLY_CUST_NO')) || undefined;

  // shape a compact preview of any response so we can see if a parts LIST came back
  function preview(d) {
    if (d == null) return null;
    if (Array.isArray(d)) return { array_len: d.length, first_keys: d[0] ? Object.keys(d[0]) : [], sample: d.slice(0, 2) };
    if (typeof d === 'object') {
      const out = { top_keys: Object.keys(d) };
      for (const k of Object.keys(d)) { if (Array.isArray(d[k])) out[k + '_len'] = d[k].length, out[k + '_first_keys'] = d[k][0] ? Object.keys(d[k][0]) : []; }
      return out;
    }
    return d;
  }

  // CORRECT schema: productlistlookup takes { lookupType, items:[{itemId, make, skuType}] }
  const attempts = [
    { ep: '/parts/productlistlookup', label: 'SANITY part# as itemId', body: { lookupType: 'Default', custNo, items: [{ itemId: 'WPW10503278', make: 'WPL' }] } },
    { ep: '/parts/productlistlookup', label: 'MODEL as itemId', body: { lookupType: 'Default', custNo, items: [{ itemId: model }] } },
    { ep: '/parts/productlistlookup', label: 'MODEL as itemId + skuType=Model', body: { lookupType: 'Default', custNo, items: [{ itemId: model, skuType: 'Model' }] } },
    { ep: '/parts/productlistlookup', label: 'MODEL + skuType=model', body: { lookupType: 'Default', custNo, items: [{ itemId: model, skuType: 'model' }] } },
    { ep: '/parts/productlistlookup', label: 'MODEL + make + skuType=Model', body: { lookupType: 'Default', custNo, items: [{ itemId: model, make: make || 'WPL', skuType: 'Model' }] } },
  ];

  const results = [];
  for (const a of attempts) {
    try {
      const r = await msupply.api('POST', a.ep, a.body);
      results.push({ label: a.label, ep: a.ep, status: r.status, ok: r.ok, preview: preview(r.data), raw_snip: (r.raw || '').slice(0, 500) });
    } catch (e) { results.push({ label: a.label, ep: a.ep, error: String((e && e.message) || e).slice(0, 160) }); }
  }

  // DECISIVE: does a PART lookup carry a compatible-models / fitment list?
  let fitment = null;
  try {
    const pn = q.part || 'WPW10503278';
    const r = await msupply.api('POST', '/parts/lookup', { partNumber: pn, make: make || 'WPL', custNo, lookupType: 'Default' });
    const list = (r.data && (r.data.partResults || r.data.parts)) || [];
    const part = Array.isArray(list) ? list[0] : (r.data && r.data.part) || r.data || {};
    const allKeys = part && typeof part === 'object' ? Object.keys(part) : [];
    const fitKeys = allKeys.filter((k) => /model|fit|compat|applic/i.test(k));
    fitment = { part_number: pn, status: r.status, all_part_keys: allKeys, fitment_like_keys: fitKeys, fitment_values: fitKeys.reduce((o, k) => (o[k] = part[k], o), {}) };
  } catch (e) { fitment = { error: String((e && e.message) || e).slice(0, 160) }; }

  return json(200, { ok: true, model, results, fitment_check: fitment });
};
