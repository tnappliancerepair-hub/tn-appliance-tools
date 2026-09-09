// google-ads-tune — two small, evidence-backed levers that need no new budget.
//
// 1. step=keywords  add keywords for queries the account is ALREADY paying for
//    but has no keyword covering. Pulled from the 30-day search-terms report:
//    14 terms took real clicks with nothing bidding on them, so they matched
//    loosely, scored badly on relevance, and cost more than they should have.
//    Each one goes into the themed ad group whose ad actually talks about it.
//
// 2. step=device   set device bid modifiers. 30-day split on the live campaign:
//      MOBILE   151 clicks   7 conv   $611.29   CPC $4.05
//      DESKTOP   29 clicks   0 conv   $ 79.49   CPC $2.74
//      TABLET     1 click    0 conv   $  2.23
//    Every conversion the account has ever recorded came from a phone. Desktop
//    is 11% of spend and has never produced one. This trims desktop rather than
//    excluding it - 29 clicks is too small to call dead with confidence, and a
//    -40% bid keeps it available while it stops setting the pace.
//
//   GET ?secret=&step=keywords          preview, writes nothing
//   ...&apply=1                         add them
//   GET ?secret=&step=device[&desktop=-40&tablet=-40][&apply=1]
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const LIVE_CAMPAIGN = '24154623729';

// term -> the themed ad group that should own it. Every one of these appeared in
// the live search-terms report with at least one paid click and no keyword.
const HARVEST = [
  { ag: 'Refrigerator Repair', kw: ['refrigerator not cooling', 'refrigerator broken', 'fridge not freezing'] },
  { ag: 'Washer Repair', kw: ['washer machine repair', 'laundry repair near me', 'washer and dryer repair'] },
  { ag: 'Oven & Range Repair', kw: ['gas stove repair', 'stove repair', 'range repair near me'] },
  { ag: 'Appliance Repair — General', kw: ['appliance technician near me', 'appliance repair company', 'fix my appliance'] },
];

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  let c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) { await new Promise((r) => setTimeout(r, 600)); c = await ads.creds(); }
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });

  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;
  const campId = String(q.campaign || LIVE_CAMPAIGN).replace(/[^0-9]/g, '');
  const apply = q.apply === '1';
  const step = String(q.step || '').toLowerCase();

  async function post(path, body) {
    let r, d;
    try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
    catch (e) { return { ok: false, err: String(e.message || e) }; }
    if (!r.ok && r.status === 403 && c.managerId) {
      try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); } catch (_) {}
    }
    const det = d.error && d.error.details && d.error.details[0] && (d.error.details[0].errors || d.error.details[0]);
    return { ok: r.ok, d, err: r.ok ? null : { message: (d.error && d.error.message) || null, detail: det || null } };
  }
  const search = (query) => post('/googleAds:search', { query });

  // ── keywords ────────────────────────────────────────────────────────────────
  if (step === 'keywords') {
    const agRes = await search(
      `SELECT ad_group.id, ad_group.name, ad_group.resource_name FROM ad_group
       WHERE campaign.id = ${campId} AND ad_group.status = 'ENABLED'`);
    const byName = {};
    for (const x of ((agRes.d && agRes.d.results) || [])) byName[x.adGroup.name] = x.adGroup.resourceName;

    const kwRes = await search(
      `SELECT ad_group_criterion.keyword.text FROM keyword_view
       WHERE campaign.id = ${campId} AND ad_group_criterion.status != 'REMOVED'`);
    const have = new Set(((kwRes.d && kwRes.d.results) || [])
      .map((x) => (x.adGroupCriterion.keyword.text || '').toLowerCase().trim()));

    const plan = [];
    for (const h of HARVEST) {
      const res = byName[h.ag];
      for (const k of h.kw) {
        if (!res) { plan.push({ ad_group: h.ag, keyword: k, skip: 'ad_group_not_found' }); continue; }
        if (have.has(k.toLowerCase())) { plan.push({ ad_group: h.ag, keyword: k, skip: 'already_present' }); continue; }
        plan.push({ ad_group: h.ag, keyword: k, resource: res });
      }
    }
    const todo = plan.filter((p) => p.resource);
    if (!apply) return json(200, { ok: true, mode: 'preview keywords', would_add: todo.length, skipped: plan.length - todo.length, plan });
    if (!todo.length) return json(200, { ok: true, mode: 'nothing to add', plan });

    // partialFailure ON here is correct: one duplicate must not reject the batch.
    // The applied-vs-sent count is reported so a silent total failure is visible.
    const res = await post('/adGroupCriteria:mutate', {
      partialFailure: true,
      operations: todo.map((p) => ({ create: { adGroup: p.resource, status: 'ENABLED', keyword: { text: p.keyword, matchType: 'PHRASE' } } })),
    });
    const applied = ((res.d && res.d.results) || []).filter((x) => x && x.resourceName).length;
    return json(200, { ok: !!res.ok, mode: 'keywords added', sent: todo.length, applied, err: res.err, plan: todo.map((p) => `${p.keyword} -> ${p.ag}`) });
  }

  // ── device ──────────────────────────────────────────────────────────────────
  if (step === 'device') {
    const pct = (v, dflt) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.max(-90, Math.min(300, n)) : dflt; };
    const want = {
      DESKTOP: pct(q.desktop, -40),
      TABLET: pct(q.tablet, -40),
      MOBILE: pct(q.mobile, 0),
    };
    const cur = await search(
      `SELECT campaign_criterion.resource_name, campaign_criterion.device.type, campaign_criterion.bid_modifier
       FROM campaign_criterion WHERE campaign.id = ${campId} AND campaign_criterion.type = 'DEVICE'`);
    const existing = {};
    for (const x of ((cur.d && cur.d.results) || [])) {
      const cc = x.campaignCriterion || {};
      existing[(cc.device && cc.device.type) || '?'] = { rn: cc.resourceName, mod: cc.bidModifier };
    }
    const plan = Object.keys(want).map((dev) => ({
      device: dev, current_modifier: existing[dev] ? existing[dev].mod : null,
      new_modifier: 1 + want[dev] / 100, action: existing[dev] ? 'update' : 'create',
    }));
    if (!apply) return json(200, { ok: true, mode: 'preview device', plan, revert_with: '&step=device&desktop=0&tablet=0&apply=1' });

    const ops = plan.map((p) => (p.action === 'update'
      ? { update: { resourceName: existing[p.device].rn, bidModifier: p.new_modifier }, updateMask: 'bid_modifier' }
      : { create: { campaign: `customers/${cid}/campaigns/${campId}`, device: { type: p.device }, bidModifier: p.new_modifier } }));
    const res = await post('/campaignCriteria:mutate', { operations: ops });
    const applied = ((res.d && res.d.results) || []).length;
    return json(200, {
      ok: !!(res.ok && applied === ops.length), mode: 'device set', sent: ops.length, applied,
      warning: applied === ops.length ? null : 'MISMATCH - verify before trusting',
      plan, err: res.err, revert_with: '&step=device&desktop=0&tablet=0&apply=1',
    });
  }

  return json(400, { ok: false, error: 'need &step=keywords or &step=device' });
};
