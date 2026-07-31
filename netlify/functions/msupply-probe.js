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

  const attempts = [
    { ep: '/parts/productlistlookup', body: { model, custNo } },
    { ep: '/parts/productlistlookup', body: { modelNumber: model, custNo } },
    { ep: '/parts/productlistlookup', body: { searchString: model, custNo } },
    { ep: '/parts/productlistlookup', body: { keyword: model, custNo } },
    { ep: '/parts/productlistlookup', body: { productList: [model], custNo } },
    { ep: '/parts/productlistlookup', body: { partNumbers: [model], custNo } },
    // does /parts/lookup fuzzy-return a LIST when given a model in partNumber?
    { ep: '/parts/lookup', body: { partNumber: model, make, custNo, lookupType: 'Model' } },
  ];

  const results = [];
  for (const a of attempts) {
    try {
      const r = await msupply.api('POST', a.ep, a.body);
      results.push({ ep: a.ep, body_fields: Object.keys(a.body), status: r.status, ok: r.ok, preview: preview(r.data), raw_snip: (r.raw || '').slice(0, 160) });
    } catch (e) { results.push({ ep: a.ep, body_fields: Object.keys(a.body), error: String((e && e.message) || e).slice(0, 160) }); }
  }
  return json(200, { ok: true, model, results });
};
