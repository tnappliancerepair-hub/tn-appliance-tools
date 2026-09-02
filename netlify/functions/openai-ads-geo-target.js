// openai-ads-geo-target — narrow a ChatGPT Ads campaign's geo from nationwide to the
// shop's real service area. The guided signup flow sets locations to the whole US
// (country id 1000232); for a LOCAL repair shop that burns budget on people who can't
// book. This resolves region/DMA geo IDs via OpenAI's geo-lookup and writes them onto
// a campaign's targeting.locations.include.
//
//   GET ?secret=&q=Tennessee,Louisiana[&type=region]        -> preview (resolve IDs, no write)
//   GET ?secret=&q=…&apply=1&campaign=cmpn_…                 -> set targeting on that campaign
//
// type: region (US state) | dma (metro) | country. Admin-gated, management key from vault.
'use strict';
const oa = require('./_lib/openai-ads');
const { getSecret } = require('./_lib/secrets');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function listOf(d) { if (!d) return []; if (Array.isArray(d)) return d; return d.data || d.results || d.locations || d.geo || []; }

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const c = await oa.creds();
  if (!c.key) return json(200, { ok: false, configured: false, error: 'OPENAI_ADS_API_KEY not vaulted' });

  const terms = String(q.q || 'Tennessee,Louisiana').split(',').map((s) => s.trim()).filter(Boolean);
  const wantType = String(q.type || 'region').toLowerCase();  // region | dma | country

  const resolved = [], debug = [];
  for (const term of terms) {
    const r = await oa.api('GET', `/geo_lookup/search?q=${encodeURIComponent(term)}&limit=10`, c.key);
    const list = listOf(r.ok ? r.d : null);
    debug.push({ term, ok: r.ok, http: r.status, count: list.length, sample: list.slice(0, 5), err: r.ok ? null : r.err });
    const usOnly = (x) => !x.country_code || x.country_code === 'US';
    const nameEq = (x) => String(x.name || '').toLowerCase() === term.toLowerCase();
    let pick = list.find((x) => String(x.type).toLowerCase() === wantType && nameEq(x) && usOnly(x))
            || list.find((x) => String(x.type).toLowerCase() === wantType && usOnly(x))
            || list.find((x) => nameEq(x) && usOnly(x))
            || list[0];
    if (pick) resolved.push({ term, id: String(pick.id), type: pick.type, name: pick.name, region_code: pick.region_code || null, canonical_name: pick.canonical_name || null });
  }

  const include = resolved.map((x) => ({ id: x.id }));
  const targeting = { locations: { include } };

  if (q.apply !== '1') {
    return json(200, { ok: true, mode: 'preview', resolved, targeting, debug, note: 'add &apply=1&campaign=<cmpn_…> to write it onto a campaign' });
  }

  const campaignId = String(q.campaign || '').replace(/[^\w-]/g, '');
  if (!campaignId) return json(200, { ok: false, error: 'need &campaign=<cmpn_…>' });
  if (!include.length) return json(200, { ok: false, error: 'no geo resolved — check debug', debug });

  // update the campaign's targeting — try PATCH first, then POST (OpenAI's update verb isn't documented)
  let up = await oa.api('PATCH', `/campaigns/${campaignId}`, c.key, { targeting });
  let via = 'PATCH';
  if (!up.ok) { const p = await oa.api('POST', `/campaigns/${campaignId}`, c.key, { targeting }); if (p.ok || (p.status && p.status !== 404 && p.status !== 405)) { up = p; via = 'POST'; } }

  // read back to confirm
  const after = await oa.api('GET', `/campaigns/${campaignId}`, c.key);
  const afterTargeting = after.ok ? (after.d && (after.d.campaign ? after.d.campaign.targeting : after.d.targeting)) : null;

  return json(200, {
    ok: up.ok, applied: up.ok, via, campaign: campaignId,
    set_targeting: targeting, resolved,
    now_targeting: afterTargeting,
    error: up.ok ? null : up.err, raw: up.ok ? undefined : up.d,
  });
};
