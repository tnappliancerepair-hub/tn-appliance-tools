// google-ads-negatives — surgically add (or remove) campaign negative keywords.
//
// Why this exists next to google-ads-optimizer: the optimizer is a SCHEDULED function, so
// Netlify's edge 403s any manual call to it, and its live path is gated behind
// GOOGLE_ADS_AUTOPILOT plus a keyword-pausing branch. When you just want to block a handful
// of wrong-intent terms and see exactly what happened, you want a small door, not the
// autopilot. This is that door: HTTP-callable, admin-gated, DRY-RUN unless you say confirm,
// and every write is reversible with do=remove.
//
//   GET ?secret=<admin>                       -> dry run: what it would add, and which of the
//                                                last 30 days' search terms each one blocks
//   GET ?secret=<admin>&confirm=yes           -> add them
//   GET ?secret=<admin>&do=remove&confirm=yes -> take them back off
//   &list=trade|geo|all                       -> which built-in list (default all)
//   &terms=a|b|c                              -> use this list instead of the built-in ones
//
// SAFETY: only ever touches ENABLED campaigns whose name contains "(Ant)" — the same guard
// the optimizer uses, so a hand-built campaign outside our naming can't be hit by accident.
'use strict';

const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// Trades TN Appliance does not work on. 30 days of live search terms bought 22 clicks and
// $77.95 of TV and vacuum repair: the ads match on "repair near me" and Google is happy to
// sell us the wrong appliance. A negative BROAD single word blocks any query containing that
// word; a multi-word entry goes in as PHRASE.
const WRONG_TRADE = ['tv', 'tvs', 'television', 'televisions', 'vacuum', 'vacuums', 'kirby', 'dyson', 'roomba'];

// Towns outside the service pods (Teddy 2026-09-09: "those are outskirts towns"). Cut on
// DRIVE TIME, not on the conversion numbers - those towns show 0 conversions, but so does
// everything else in this account: "Ant - Booked Job" has never fired, and 18 clicks is far
// too small a sample to prove anything either way. A stop 45 minutes past the pod costs the
// same whether or not the tracking works, which is a reason that survives the broken gauge.
//
// This blocks people SEARCHING for these towns from anywhere. It does not stop someone
// physically in one of them searching "appliance repair near me" - that is location
// targeting, a separate change. The live search terms literally name these towns, so this
// is the half that matches the observed waste.
const OUTSKIRTS = ['gallatin', 'dickson', 'springfield', 'columbia', 'shelbyville', 'spring hill', 'lebanon'];

const LISTS = { trade: WRONG_TRADE, geo: OUTSKIRTS, all: WRONG_TRADE.concat(OUTSKIRTS) };

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (String(q.secret || '') !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false, note: 'Google Ads creds missing from the vault.' });
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;

  async function api(path, body) {
    let r, d;
    try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, cid), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
    catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
    // A 403 on the direct customer often means the call must go through the manager account.
    if (!r.ok && r.status === 403 && c.managerId) {
      try { r = await fetch(`${base}${path}`, { method: 'POST', headers: ads.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); } catch (_) {}
    }
    return { ok: r.ok, status: r.status, d, err: r.ok ? null : ((d && d.error && d.error.message) || JSON.stringify(d).slice(0, 300)) };
  }
  const search = (gaql) => api('/googleAds:search', { query: gaql });

  const terms = String(q.terms || '').trim()
    ? String(q.terms).split('|').map((t) => t.trim().toLowerCase()).filter(Boolean)
    : (LISTS[String(q.list || 'all').toLowerCase()] || LISTS.all).slice();
  const matchOf = (t) => (t.indexOf(' ') >= 0 ? 'PHRASE' : 'BROAD');

  // Our campaigns only.
  const campRes = await search("SELECT campaign.id, campaign.name, campaign.resource_name FROM campaign WHERE campaign.name LIKE '%(Ant)%' AND campaign.status = 'ENABLED'");
  if (!campRes.ok) return json(200, { ok: false, step: 'list_campaigns', error: campRes.err });
  const camps = (campRes.d.results || []).map((x) => ({ name: x.campaign.name, resource: x.campaign.resourceName }));
  if (!camps.length) return json(200, { ok: true, note: 'No ENABLED "(Ant)" campaigns — nothing to do.', campaigns: [] });

  // What is already negatived, so we neither duplicate nor claim a false win.
  const existRes = await search('SELECT campaign_criterion.resource_name, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign.resource_name FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = KEYWORD');
  const existing = {};
  for (const x of ((existRes.ok && existRes.d.results) || [])) {
    const kw = x.campaignCriterion && x.campaignCriterion.keyword;
    if (!kw) continue;
    existing[(x.campaign.resourceName + '|' + String(kw.text || '').toLowerCase())] = x.campaignCriterion.resourceName;
  }

  // ── REMOVE ──
  if (String(q.do || '') === 'remove') {
    const kill = [];
    for (const camp of camps) for (const t of terms) {
      const rn = existing[camp.resource + '|' + t];
      if (rn) kill.push({ campaign: camp.name, term: t, resource: rn });
    }
    if (!kill.length) return json(200, { ok: true, mode: 'remove', found: 0, note: 'None of those are currently negatived.' });
    if (q.confirm !== 'yes') return json(200, { ok: true, mode: 'remove-dryrun', would_remove: kill.length, detail: kill, note: 'Add &confirm=yes to actually remove.' });
    const m = await api('/campaignCriteria:mutate', { partialFailure: true, operations: kill.map((k) => ({ remove: k.resource })) });
    return json(200, { ok: !!m.ok, mode: 'remove', removed: (m.d && m.d.results ? m.d.results.filter(Boolean).length : 0), error: m.err, detail: kill });
  }

  // ── ADD ──
  // Show what each negative actually blocks, measured against real spend, so a dry run is
  // a decision you can make rather than a list you have to trust.
  const stRes = await search("SELECT search_term_view.search_term, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE segments.date DURING LAST_30_DAYS AND campaign.name LIKE '%(Ant)%'");
  const blocks = {};
  let blockedCost = 0, blockedClicks = 0, blockedConv = 0;
  for (const x of ((stRes.ok && stRes.d.results) || [])) {
    const term = String((x.searchTermView && x.searchTermView.searchTerm) || '').toLowerCase();
    const hit = terms.find((t) => (t.indexOf(' ') >= 0
      ? term.indexOf(t) >= 0
      : new RegExp('(^|[^a-z])' + t + '([^a-z]|$)').test(term)));
    if (!hit) continue;
    const cost = Math.round((Number(x.metrics.costMicros || 0) / 1e6) * 100) / 100;
    const conv = Number(x.metrics.conversions || 0);
    blockedCost += cost; blockedClicks += Number(x.metrics.clicks || 0); blockedConv += conv;
    (blocks[hit] = blocks[hit] || []).push({ term, cost, clicks: Number(x.metrics.clicks || 0), conversions: conv });
  }

  const plan = [];
  for (const camp of camps) for (const t of terms) {
    if (existing[camp.resource + '|' + t]) continue;   // already blocked
    plan.push({ campaign: camp.name, campaign_resource: camp.resource, term: t, match: matchOf(t) });
  }

  const impact = {
    last_30d_spend_these_terms_would_have_blocked: Math.round(blockedCost * 100) / 100,
    clicks_blocked: blockedClicks,
    conversions_blocked: blockedConv,
    by_negative: Object.keys(blocks).sort().map((k) => ({
      negative: k, match: matchOf(k),
      spend: Math.round(blocks[k].reduce((a, b) => a + b.cost, 0) * 100) / 100,
      terms: blocks[k].sort((a, b) => b.cost - a.cost).slice(0, 6),
    })),
  };

  if (q.confirm !== 'yes') {
    return json(200, { ok: true, mode: 'dryrun', campaigns: camps.map((c2) => c2.name), would_add: plan.length, already_present: (terms.length * camps.length) - plan.length, plan, impact, note: 'Add &confirm=yes to apply. Reversible with &do=remove&confirm=yes.' });
  }
  if (!plan.length) return json(200, { ok: true, mode: 'live', added: 0, note: 'All of those were already negatived.', impact });

  const m = await api('/campaignCriteria:mutate', {
    partialFailure: true,
    operations: plan.map((p) => ({ create: { campaign: p.campaign_resource, negative: true, keyword: { text: p.term, matchType: p.match } } })),
  });
  const added = (m.d && m.d.results ? m.d.results.filter(Boolean).length : 0);
  return json(200, { ok: !!m.ok, mode: 'live', added, error: m.err, partial_errors: (m.d && m.d.partialFailureError) ? String(m.d.partialFailureError.message || '').slice(0, 400) : null, plan, impact });
};
