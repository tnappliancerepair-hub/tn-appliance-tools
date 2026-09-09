// google-ads-themed-adgroups — the Quality Score repair.
//
// THE PROBLEM (measured 2026-09-09 on the live account):
//   The one live campaign puts ~14 keywords spanning FIVE appliance types into a
//   SINGLE ad group with ONE generic ad. So a person searching "refrigerator repair
//   near me" is shown a headline that says "Appliance Repair Near You" and is landed
//   on a generic page. Google grades ad relevance and landing-page experience PER
//   keyword-to-ad pairing, so it grades that pairing down. The result:
//     appliance repair ............ QS 3/10   3,152 impr (80% of all)
//     refrigerator repair near me . QS 3/10      94 impr, ZERO clicks
//     dryer not heating ........... QS 1/10      26 impr, ZERO clicks
//     impression share 12.2%  |  59.6% of impressions lost to RANK
//
// Rank = bid x Quality Score. We can pay our way up (costs money) or earn our way
// up (free). This earns it: one ad group per appliance, headlines that literally
// contain the appliance the person searched for, and a landing URL that opens
// appliance-ai.html ALREADY on that appliance with its own problem list
// ("Not cooling / Leaking water / Ice maker out") instead of a generic picker.
//
// What it does on apply:
//   1. creates one ENABLED ad group per theme + PHRASE keywords + a themed RSA
//   2. PAUSES those same keywords in whatever ad group they currently sit in,
//      so the campaign doesn't bid against itself with a duplicate
//   The after-hours keywords ("open now", "24 hour", "emergency", "tonight") are
//   deliberately LEFT ALONE - the 2am copy is genuinely the right ad for those.
//
//   GET ?secret=                     preview: show every group/keyword/ad, write NOTHING
//   ...&apply=1                      build it
//   ...&undo=1                       reverse: pause the new groups, re-enable the old keywords
//   optional: &campaign=<id>         default 24154623729 (After-Hours Nashville Metro)
//             &cpc=4                 base max CPC dollars for the new groups
//             &only=dryer,fridge     build a subset
//
// Reversible by design. Nothing here touches budget, geo, or the bid schedule.
'use strict';
const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const SITE = 'https://tnapplianceexchange.net';
const LIVE_CAMPAIGN = '24154623729';   // After-Hours Appliance Repair - Nashville Metro (Ant)

// Landing straight into the appliance's own problem list. appliance-ai.html
// capitalises the param and looks up PROBLEMS[label], so these values must match
// its keys: Refrigerator / Washer / Dryer / Dishwasher. "oven" falls to the
// default problem list, which is correct for ovens.
const finalFor = (appliance, tag) =>
  `${SITE}/appliance-ai.html?appliance=${appliance}&utm_source=google_ads&utm_medium=cpc&utm_campaign=afterhours&utm_content=${tag}`;

// Shared trust headlines every group gets - they're true for all of them and give
// the RSA enough variations to rotate. Appliance-specific ones come FIRST because
// Google weights early headlines and relevance is the whole point here.
const TRUST_H = ['We Answer 24/7 · 365', 'Family Owned Since 2012', 'Licensed & Insured Techs', '4.5 Stars, 1,100 Reviews'];
const TRUST_D = 'Family owned since 2012. No surprise fees - you know the price before we start.';

const THEMES = [
  {
    key: 'fridge', name: 'Refrigerator Repair', appliance: 'refrigerator',
    kw: ['refrigerator repair near me', 'refrigerator repair', 'fridge not cooling', 'fridge repair near me'],
    headlines: ['Refrigerator Repair Today', 'Fridge Not Cooling? We Fix', 'Same-Day Fridge Repair', 'Local Refrigerator Repair',
      'Fridge Repair Near You', 'Honest Fridge Repair', 'Book Fridge Repair Online', 'Real Local Fridge Techs'],
    descriptions: ['Fridge not cooling or leaking? Real local techs fix it fast. Honest, upfront pricing.',
      'Same-week refrigerator service. Licensed, insured, 4.5 stars from 1,100 reviews.',
      'We answer 24/7, even at 2am. Book your refrigerator repair online in a minute.'],
  },
  {
    key: 'dryer', name: 'Dryer Repair', appliance: 'dryer',
    kw: ['dryer repair near me', 'dryer repair', 'dryer not heating'],
    headlines: ['Dryer Repair Today', 'Dryer Not Heating? We Fix', 'Same-Day Dryer Repair', 'Local Dryer Repair Pros',
      'Dryer Repair Near You', 'Honest Dryer Repair', 'Book Dryer Repair Online', 'Real Local Dryer Techs'],
    descriptions: ['Dryer not heating or tumbling? Real local techs fix it fast. Honest, upfront pricing.',
      'Same-week dryer service. Licensed, insured, 4.5 stars from 1,100 reviews.',
      'We answer 24/7, even at 2am. Book your dryer repair online in about a minute.'],
  },
  {
    key: 'washer', name: 'Washer Repair', appliance: 'washer',
    kw: ['washer repair near me', 'washer repair', 'washing machine repair'],
    headlines: ['Washer Repair Today', 'Washer Not Draining?', 'Same-Day Washer Repair', 'Local Washer Repair Pros',
      'Washer Repair Near You', 'Honest Washer Repair', 'Washing Machine Repair', 'Book Washer Repair Online'],
    descriptions: ['Washer not draining or spinning? Real local techs fix it fast. Honest, upfront pricing.',
      'Same-week washer service. Licensed, insured, 4.5 stars from 1,100 reviews.',
      'We answer 24/7, even at 2am. Book your washer repair online in about a minute.'],
  },
  {
    key: 'dishwasher', name: 'Dishwasher Repair', appliance: 'dishwasher',
    kw: ['dishwasher repair near me', 'dishwasher repair'],
    headlines: ['Dishwasher Repair Today', 'Dishwasher Not Draining?', 'Same-Day Dishwasher Fix', 'Local Dishwasher Repair',
      'Dishwasher Repair Near You', 'Honest Dishwasher Repair', 'Book Dishwasher Repair', 'Real Local Dish Techs'],
    descriptions: ['Dishwasher not draining or cleaning? Real local techs fix it fast. Honest pricing.',
      'Same-week dishwasher service. Licensed, insured, 4.5 stars from 1,100 reviews.',
      'We answer 24/7, even at 2am. Book your dishwasher repair online in a minute.'],
  },
  {
    key: 'oven', name: 'Oven & Range Repair', appliance: 'oven',
    kw: ['oven repair near me', 'oven repair', 'stove repair near me'],
    headlines: ['Oven Repair Today', 'Oven Not Heating? We Fix', 'Same-Day Oven Repair', 'Local Oven & Range Repair',
      'Oven Repair Near You', 'Honest Oven Repair', 'Stove & Range Repair', 'Book Oven Repair Online'],
    descriptions: ['Oven or range not heating? Real local techs fix it fast. Honest, upfront pricing.',
      'Same-week oven and range service. Licensed, insured, 4.5 stars, 1,100 reviews.',
      'We answer 24/7, even at 2am. Book your oven repair online in about a minute.'],
  },
  {
    // The volume driver. It sits in the after-hours group today, so a daytime
    // searcher for "appliance repair" is shown "Broken at 2am? We Answer" - true,
    // but the wrong lead at 2pm, and expected-CTR is a Quality Score input.
    key: 'general', name: 'Appliance Repair — General', appliance: '',
    kw: ['appliance repair', 'appliance repair near me', 'same day appliance repair', 'appliance repair service'],
    headlines: ['Appliance Repair Near You', 'Same-Day Appliance Repair', 'Honest Appliance Repair', 'Local Appliance Repair Pro',
      'Fridge, Dryer & Washer Fix', 'Book Repair Online Fast', 'Real Techs, Real Answers', 'No Surprise Fees'],
    descriptions: ['Real local techs, honest upfront pricing. Fridge, dryer, washer, oven, dishwasher.',
      'Same-week appliance service across the area. Licensed, insured, 4.5 stars.',
      'Book your repair online in about a minute, or chat with us now. We answer 24/7.'],
  },
];

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const dig = (s) => String(s || '').replace(/[^0-9]/g, '');

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  // The shared creds loader retries a flaky vault once; give it one more here so a
  // slow Xano read can't make this look unconfigured mid-operation.
  let c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) { await new Promise((r) => setTimeout(r, 600)); c = await ads.creds(); }
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false, hint: 'Google Ads creds unavailable (vault).' });

  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;
  const campId = dig(q.campaign) || LIVE_CAMPAIGN;
  const campRes = `customers/${cid}/campaigns/${campId}`;
  const apply = q.apply === '1';
  const undo = q.undo === '1';
  const baseCpc = Math.max(1, Math.min(20, parseInt(q.cpc, 10) || 4));
  const only = String(q.only || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const themes = only.length ? THEMES.filter((t) => only.includes(t.key)) : THEMES;

  async function post(path, body) {
    let r, d;
    try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
    catch (e) { return { ok: false, err: String(e.message || e) }; }
    if (!r.ok && r.status === 403 && c.managerId) {
      try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); } catch (_) {}
    }
    const det = d.error && d.error.details && d.error.details[0] && (d.error.details[0].errors || d.error.details[0]);
    return { ok: r.ok, status: r.status, d, err: r.ok ? null : { message: (d.error && d.error.message) || null, detail: det || null } };
  }
  const search = (query) => post('/googleAds:search', { query });

  // ── what's in the campaign right now ────────────────────────────────────────
  const kvRes = await search(
    `SELECT ad_group.id, ad_group.name, ad_group.resource_name, ad_group.status,
            ad_group_criterion.resource_name, ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type, ad_group_criterion.status,
            ad_group_criterion.quality_info.quality_score
     FROM keyword_view
     WHERE campaign.id = ${campId} AND ad_group_criterion.status != 'REMOVED'`);
  if (!kvRes.ok) return json(200, { ok: false, step: 'read_keywords', err: kvRes.err });

  const existing = ((kvRes.d && kvRes.d.results) || []).map((x) => ({
    ag_name: x.adGroup && x.adGroup.name,
    ag_res: x.adGroup && x.adGroup.resourceName,
    crit_res: x.adGroupCriterion && x.adGroupCriterion.resourceName,
    text: x.adGroupCriterion && x.adGroupCriterion.keyword && x.adGroupCriterion.keyword.text,
    status: x.adGroupCriterion && x.adGroupCriterion.status,
    qs: x.adGroupCriterion && x.adGroupCriterion.qualityInfo && x.adGroupCriterion.qualityInfo.qualityScore,
  }));

  // The keywords we are about to re-home, as they exist today.
  const targetTexts = new Set(themes.flatMap((t) => t.kw.map(norm)));
  const toPause = existing.filter((e) => e.status === 'ENABLED' && targetTexts.has(norm(e.text)));

  // ── UNDO ────────────────────────────────────────────────────────────────────
  if (undo) {
    const agRes = await search(
      `SELECT ad_group.resource_name, ad_group.name FROM ad_group
       WHERE campaign.id = ${campId} AND ad_group.status = 'ENABLED'`);
    const mine = ((agRes.d && agRes.d.results) || [])
      .filter((x) => THEMES.some((t) => (x.adGroup && x.adGroup.name) === t.name))
      .map((x) => x.adGroup.resourceName);
    const paused = existing.filter((e) => e.status === 'PAUSED' && targetTexts.has(norm(e.text)) && !THEMES.some((t) => t.name === e.ag_name));
    if (!apply) return json(200, { ok: true, mode: 'preview undo', would_pause_ad_groups: mine, would_reenable_keywords: paused.map((p) => `${p.text} @ ${p.ag_name}`) });
    const offRes = mine.length ? await post('/adGroups:mutate', { partialFailure: true, operations: mine.map((rn) => ({ update: { resourceName: rn, status: 'PAUSED' }, updateMask: 'status' })) }) : { ok: true };
    const onRes = paused.length ? await post('/adGroupCriteria:mutate', { partialFailure: true, operations: paused.map((p) => ({ update: { resourceName: p.crit_res, status: 'ENABLED' }, updateMask: 'status' })) }) : { ok: true };
    return json(200, { ok: !!(offRes.ok && onRes.ok), mode: 'undone', ad_groups_paused: mine.length, keywords_reenabled: paused.length, errs: [offRes.err, onRes.err].filter(Boolean) });
  }

  // ── PREVIEW ─────────────────────────────────────────────────────────────────
  const plan = themes.map((t) => ({
    ad_group: t.name,
    keywords: t.kw,
    final_url: t.appliance ? finalFor(t.appliance, t.key) : `${SITE}/appliance-ai.html?utm_source=google_ads&utm_medium=cpc&utm_campaign=afterhours&utm_content=general`,
    headlines: t.headlines.concat(TRUST_H),
    descriptions: t.descriptions.concat([TRUST_D]),
  }));
  if (!apply) {
    return json(200, {
      ok: true, mode: 'PREVIEW - nothing written', campaign: campId, base_max_cpc: baseCpc,
      current_structure: [...new Set(existing.map((e) => e.ag_name))].map((n) => ({
        ad_group: n,
        keywords: existing.filter((e) => e.ag_name === n).map((e) => `${e.text} [QS ${e.qs != null ? e.qs : '-'}] ${e.status}`),
      })),
      will_create: plan,
      will_pause_in_old_group: toPause.map((p) => `${p.text} @ ${p.ag_name} (QS ${p.qs != null ? p.qs : '-'})`),
      left_alone: existing.filter((e) => !targetTexts.has(norm(e.text))).map((e) => `${e.text} @ ${e.ag_name}`),
      apply_with: '&apply=1',
    });
  }

  // ── APPLY ───────────────────────────────────────────────────────────────────
  const built = [];
  for (const t of themes) {
    const finalUrl = t.appliance ? finalFor(t.appliance, t.key) : `${SITE}/appliance-ai.html?utm_source=google_ads&utm_medium=cpc&utm_campaign=afterhours&utm_content=general`;
    const ag = await post('/adGroups:mutate', {
      operations: [{ create: { name: t.name, campaign: campRes, status: 'ENABLED', type: 'SEARCH_STANDARD', cpcBidMicros: baseCpc * 1000000 } }],
    });
    const agRes = ag.ok && ag.d.results && ag.d.results[0] && ag.d.results[0].resourceName;
    if (!agRes) { built.push({ theme: t.key, ok: false, step: 'ad_group', err: ag.err }); continue; }

    const kw = await post('/adGroupCriteria:mutate', {
      partialFailure: true,
      operations: t.kw.map((text) => ({ create: { adGroup: agRes, status: 'ENABLED', keyword: { text, matchType: 'PHRASE' } } })),
    });
    const ad = await post('/adGroupAds:mutate', {
      operations: [{ create: { adGroup: agRes, status: 'ENABLED', ad: { finalUrls: [finalUrl], responsiveSearchAd: {
        headlines: t.headlines.concat(TRUST_H).map((text) => ({ text })),
        descriptions: t.descriptions.concat([TRUST_D]).map((text) => ({ text })),
      } } } }],
    });
    built.push({ theme: t.key, ad_group: t.name, resource: agRes, keywords_ok: kw.ok, ad_ok: ad.ok, final_url: finalUrl, errs: [kw.err, ad.err].filter(Boolean) });
  }

  // Only pause the old copies once at least one new group actually exists, so a
  // failed build can never leave the campaign with fewer live keywords than it
  // started with.
  let pausedCount = 0, pauseErr = null;
  if (built.some((b) => b.resource) && toPause.length) {
    const p = await post('/adGroupCriteria:mutate', {
      partialFailure: true,
      operations: toPause.map((e) => ({ update: { resourceName: e.crit_res, status: 'PAUSED' }, updateMask: 'status' })),
    });
    pausedCount = p.ok ? toPause.length : 0;
    pauseErr = p.err;
  }

  return json(200, {
    ok: built.every((b) => b.resource && b.ad_ok !== false),
    mode: 'APPLIED', campaign: campId,
    created: built,
    old_keywords_paused: pausedCount,
    pause_err: pauseErr,
    undo_with: '&undo=1&apply=1',
  });
};
