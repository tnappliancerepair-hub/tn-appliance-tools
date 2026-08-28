// brain-recall — the read path out of the shared brain. Given a machine + symptom, returns the
// pooled, grade-weighted "here's what fails on this platform + the part" ranking across ALL
// contributing shops. Calls the ANT OPS aggregate RPCs (brain_common_failures / brain_predict_part)
// with the service key. Returns ONLY de-identified aggregates — no raw rows, no shop identity,
// no customer, no price. `min_shops` enforces "needs >= N distinct shops before we surface it"
// (1 in shadow; 3 at go-live per the operating plan). SHADOW: built + admin-gated, not yet wired
// into any tenant diagnosis surface.
//
//   GET ?secret=<admin>&model=WTW5000DW1&brand=Whirlpool&appliance=Washer[&symptom=...][&min_shops=1]
'use strict';
const { getSecret } = require('./_lib/secrets');
const { deriveFamily } = require('./_lib/brain-deid');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function rpc(base, key, fn, args) {
  const r = await fetch(`${base.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return { err: r.status };
  return { rows: await r.json().catch(() => []) };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const base = (await getSecret('SUPABASE_URL')) || '';
  const key = (await getSecret('SUPABASE_SERVICE_KEY')) || '';
  if (!base || !key) return json(200, { ok: false, error: 'ANT OPS not configured' });

  const model = String(q.model || '').trim();
  const brand = String(q.brand || '').trim();
  const appliance = String(q.appliance || '').trim();
  const symptom = String(q.symptom || '').trim();
  const minShops = Math.max(1, parseInt(q.min_shops || '1', 10) || 1);
  const family = deriveFamily(model);

  // family-first, brand+appliance fallback
  const argsFam = { p_family: family || null, p_brand: null, p_appliance: null };
  const argsBA = { p_family: null, p_brand: brand || null, p_appliance: appliance || null };

  const [failFam, failBA, partFam, partBA] = await Promise.all([
    family ? rpc(base, key, 'brain_common_failures', argsFam) : { rows: [] },
    (brand && appliance) ? rpc(base, key, 'brain_common_failures', argsBA) : { rows: [] },
    family ? rpc(base, key, 'brain_predict_part', { ...argsFam, p_symptom: symptom || null }) : { rows: [] },
    (brand && appliance) ? rpc(base, key, 'brain_predict_part', { ...argsBA, p_symptom: symptom || null }) : { rows: [] },
  ]);

  const gate = (rows) => (rows || []).filter((r) => Number(r.contributor_count || 0) >= minShops);
  const failures = gate(failFam.rows).length ? { match: 'platform_family', family, rows: gate(failFam.rows) }
    : { match: 'brand_appliance', family, rows: gate(failBA.rows) };
  const parts = gate(partFam.rows).length ? { match: 'platform_family', rows: gate(partFam.rows) }
    : { match: 'brand_appliance', rows: gate(partBA.rows) };

  return json(200, {
    ok: true, shadow: true, min_shops: minShops,
    query: { model, family, brand, appliance, symptom },
    common_failures: failures,
    predicted_parts: parts,
    note: 'de-identified pooled knowledge only — no shop identity, no customer, no price',
  });
};
