// openai-ads-create-campaign — stand up a ChatGPT Ads campaign from one command:
// campaign → ad group → ad, from an appliance-keyed copy kit that leads with the
// 24/7 "Broken at 2am? We Answer" angle (our real edge — a live AI answers every
// call, day or night). Previews with NO key so we can eyeball the payload; applies
// only with &apply=1 once the key is vaulted.
//
//   GET ?secret=&appliance=dryer|refrigerator|general|saas&budget=25&days=30[&national=1][&cities=..][&final=..]
//        preview: show the campaign/ad-group/ad plan, write nothing (no key needed)
//   ...&apply=1          create it PAUSED (no spend) — review it first
//   ...&apply=1&live=1   create it ACTIVE — CHARGES immediately (OpenAI has no separate enable step)
//   appliance=saas = the B2B AssistAnt play: owner copy, national by default, lands on the /guide lead magnet.
//
// NOTE: OpenAI documents the campaign body ({name,status,budget}) but not the full
// ad-group/ad/targeting schema — those field names get finalized against the live
// API on the first real &apply=1 (same first-real-tuning discipline as our HCP/
// Jobber adapters). The preview + step-by-step error returns make that a 5-min tune.
'use strict';
const { getSecret } = require('./_lib/secrets');
const oa = require('./_lib/openai-ads');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// appliance → headlines/descriptions/landing. Leads with the 24/7 always-answer
// angle: nobody else in appliance repair answers the phone at 2am with a real AI.
const KITS = {
  general: {
    label: 'Appliance Repair — 24/7',
    headlines: ['Broken at 2am? We Answer', 'Appliance Repair, Any Hour', 'Real Help 24/7 — Nashville', 'Same-Week Appliance Repair', 'Honest, Technician-Led Repair', 'Text, Call or Video Anytime'],
    descriptions: ['Fridge, washer, dryer, oven — a real tech answers 24/7. Book online, honest flat pricing.', 'Family-owned since 2012, 4.5★ / 1,000+ reviews. Same-week service across Middle Tennessee.'],
    final: 'https://tnapplianceexchange.net/always-open.html',
  },
  dryer: {
    label: 'Dryer Repair — 24/7',
    headlines: ['Dryer Broken at 2am?', 'Dryer Not Heating? We Answer', 'Fast Dryer Repair 24/7', 'Same-Week Dryer Repair', 'Honest Dryer Repair', 'Book Dryer Repair Anytime'],
    descriptions: ['Dryer not heating or spinning? A real tech answers 24/7 and books your repair fast.', 'Honest flat pricing, family-owned since 2012. Same-week service across Middle Tennessee.'],
    final: 'https://tnapplianceexchange.net/appliance-ai.html?appliance=dryer',
  },
  refrigerator: {
    label: 'Refrigerator Repair — 24/7',
    headlines: ['Fridge Down at 2am? We Answer', 'Refrigerator Not Cooling?', 'Fast Fridge Repair 24/7', 'Same-Week Fridge Repair', 'Honest Refrigerator Repair', 'Book Fridge Repair Anytime'],
    descriptions: ['Fridge not cooling? A real tech answers 24/7 and gets you booked before the food spoils.', 'Honest flat pricing, family-owned since 2012. Same-week service across Middle Tennessee.'],
    final: 'https://tnapplianceexchange.net/appliance-ai.html?appliance=refrigerator',
  },
  // B2B — the AssistAnt PLATFORM to other shop owners (when someone asks ChatGPT
  // "what software should an appliance repair shop use"). Led by the referral/free hook.
  saas: {
    label: 'AssistAnt — Shop Software',
    headlines: ['Run Your Shop for $99/mo', 'Refer 4 Shops = Yours Free', 'AI Answers Every Call 24/7', 'Free Setup, No Per-Seat Fee', 'Housecall Pro Alternative', 'Built By a Real Repair Shop'],
    descriptions: ['Run your whole appliance shop for $99/mo flat — every tech included, free setup. Refer 4 buddy shops and yours is free.', 'AI answers 24/7 and books the job. Bring your data off Housecall Pro, Jobber or Workiz in a day. Built by a shop that runs on it.'],
    final: 'https://tnapplianceexchange.net/guide',   // cold-B2B lead magnet (captures the owner) — not the tour
    // ChatGPT Ads has no owner-audience selector — context_hints is how you aim it. These steer it to
    // shop owners when someone asks ChatGPT what to run their business on.
    context: ['appliance repair shop owners', 'field service business owners', 'small business owners in the trades', 'people choosing software to run a repair business'],
    image: 'https://tnapplianceexchange.net/assistant-og.png',
  },
};

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  // Cleanup: DELETE a campaign by id (removes an orphan/paused shell). ?delete=<campaign_id>
  if ((q.delete || '').trim()) {
    const cc = await oa.creds();
    if (!cc.key) return json(200, { ok: false, error: 'OPENAI_ADS_API_KEY not vaulted' });
    const del = await oa.api('DELETE', '/campaigns/' + q.delete.trim(), cc.key);
    return json(200, { ok: !!del.ok, deleted: q.delete.trim(), status: del.status, err: del.err || null });
  }

  const appl = String(q.appliance || 'general').toLowerCase();
  const kit = KITS[appl] || KITS.general;
  if ((q.final || '').trim()) kit.final = q.final.trim();
  const budget = Math.max(5, Math.min(500, parseInt(q.budget, 10) || 25));   // daily cap ($)
  const days = Math.max(1, Math.min(365, parseInt(q.days, 10) || 30));
  const lifetime = parseInt(q.lifetime, 10) > 0 ? parseInt(q.lifetime, 10) : budget * days;
  const apply = q.apply === '1';
  // National for a SaaS play (sold everywhere): ?national=1, or the saas kit defaults national
  // unless explicit ?cities= is passed. Local repair kits keep the TN+BR city list.
  const nationalReq = q.national === '1' || (appl === 'saas' && !q.cities);
  const cities = nationalReq ? ['United States'] : String(q.cities || 'Nashville,Antioch,Murfreesboro,Smyrna,La Vergne,Baton Rouge').split(',').map((s) => s.trim()).filter(Boolean);
  const geoLabel = nationalReq ? 'US' : cities.slice(0, 2).join('/');
  // SAFETY: OpenAI Ads has no separate enable step — so we create PAUSED by default and only go
  // straight to ACTIVE (live spend) when &live=1 is explicitly passed. Review it, then flip live.
  const goLive = q.live === '1';
  const status = goLive ? 'active' : 'paused';
  const maxBid = Math.max(0.05, Math.min(50, parseFloat(q.max_bid) || 2));      // per-click ceiling ($)
  const maxBidMicros = Math.round(maxBid * 1000000);
  const image = kit.image || 'https://tnapplianceexchange.net/assistant-og.png';

  const name = `${kit.label} — ${geoLabel} (Ant)`;
  const campaignBody = { name, status, budget: { lifetime_spend_limit_micros: lifetime * 1000000 } };
  const plan = {
    campaign: name, appliance: appl, national: nationalReq, create_status: status, daily_budget: budget, days, lifetime_budget: lifetime,
    max_bid_per_click: maxBid, campaign_body: campaignBody, cities, final_url: kit.final, creative_image: image,
    context_hints: kit.context || null, headlines: kit.headlines, descriptions: kit.descriptions,
  };

  const c = await oa.creds();
  if (!apply) return json(200, { ok: true, mode: 'preview', configured: !!c.key, plan, note: 'add &apply=1 to CREATE it PAUSED (no spend). Then review + add &live=1 to go ACTIVE (starts charging). Preview needs no key.' });
  if (!c.key) return json(200, { ok: false, configured: false, error: 'OPENAI_ADS_API_KEY not vaulted', plan });

  // 1) campaign — the documented body shape.
  const camp = await oa.api('POST', '/campaigns', c.key, campaignBody);
  if (!camp.ok) return json(200, { ok: false, step: 'campaign', error: camp.err, plan });
  const campaignId = (camp.d && (camp.d.id || (camp.d.campaign && camp.d.campaign.id))) || null;

  // 2) ad group — requires bidding_config; audience steered by context_hints (geo lives on the
  //    campaign via location IDs, so a national play just omits campaign targeting — done above).
  const agBody = {
    campaign_id: campaignId, name: `${kit.label} ad group`, status,
    bidding_config: { billing_event_type: 'click', max_bid_micros: maxBidMicros },
  };
  if (kit.context && kit.context.length) agBody.context_hints = kit.context;
  const ag = await oa.api('POST', '/ad_groups', c.key, agBody);
  const adGroupId = ag.ok ? ((ag.d && (ag.d.id || (ag.d.ad_group && ag.d.ad_group.id))) || null) : null;

  // 3) creative — a chat_card needs an uploaded image (file_id). Upload the hosted card, then
  //    build the chat_card ad (single title + body + target_url).
  let ad = { ok: false, err: 'skipped — no ad_group' };
  let fileId = null;
  if (adGroupId) {
    const up = await oa.api('POST', '/upload', c.key, { image_url: image });
    fileId = (up.d && (up.d.file_id || up.d.id)) || null;
    if (!fileId) { ad = { ok: false, err: 'upload failed: ' + (up.err || 'no file_id') }; }
    else {
      const adBody = {
        ad_group_id: adGroupId, name: `${kit.label} ad`, status,
        creative: { type: 'chat_card', title: kit.headlines[0], body: kit.descriptions[0], target_url: kit.final, file_id: fileId },
      };
      ad = await oa.api('POST', '/ads', c.key, adBody);
    }
  }

  return json(200, {
    ok: !!camp.ok, mode: 'created', campaign_id: campaignId,
    campaign: { ok: camp.ok, id: campaignId },
    ad_group: { ok: ag.ok, id: adGroupId, err: ag.err || null },
    ad: { ok: ad.ok, id: ad.ok ? ((ad.d && (ad.d.id || (ad.d.ad && ad.d.ad.id))) || null) : null, file_id: fileId, err: ad.err || null },
    created_status: status, plan,
    note: (ag.ok && ad.ok)
      ? (goLive ? 'created ACTIVE — spending now.' : 'created PAUSED — review it, then re-run with &live=1 (or activate in the OpenAI Ads dashboard) to start spend.')
      : 'campaign created; ad-group/ad shapes need tuning against the live API response (see err).',
  });
};
