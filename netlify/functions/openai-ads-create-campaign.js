// openai-ads-create-campaign — stand up a ChatGPT Ads campaign from one command:
// campaign → ad group → ad, from an appliance-keyed copy kit that leads with the
// 24/7 "Broken at 2am? We Answer" angle (our real edge — a live AI answers every
// call, day or night). Previews with NO key so we can eyeball the payload; applies
// only with &apply=1 once the key is vaulted.
//
//   GET ?secret=&appliance=dryer|refrigerator|general&budget=25&days=30
//        preview: show the campaign/ad-group/ad plan, write nothing (no key needed)
//   ...&apply=1   create it (status active) — CHARGES once live
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
    final: 'https://assistant247.net',
  },
};

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const appl = String(q.appliance || 'general').toLowerCase();
  const kit = KITS[appl] || KITS.general;
  if ((q.final || '').trim()) kit.final = q.final.trim();
  const budget = Math.max(5, Math.min(500, parseInt(q.budget, 10) || 25));   // daily cap ($)
  const days = Math.max(1, Math.min(365, parseInt(q.days, 10) || 30));
  const lifetime = parseInt(q.lifetime, 10) > 0 ? parseInt(q.lifetime, 10) : budget * days;
  const apply = q.apply === '1';
  const cities = String(q.cities || 'Nashville,Antioch,Murfreesboro,Smyrna,La Vergne,Baton Rouge').split(',').map((s) => s.trim()).filter(Boolean);

  const name = `${kit.label} — ${cities.slice(0, 2).join('/')} (Ant)`;
  const campaignBody = { name, status: 'active', budget: { lifetime_spend_limit_micros: lifetime * 1000000 } };
  const plan = {
    campaign: name, appliance: appl, daily_budget: budget, days, lifetime_budget: lifetime,
    campaign_body: campaignBody, cities, final_url: kit.final,
    headlines: kit.headlines, descriptions: kit.descriptions,
  };

  const c = await oa.creds();
  if (!apply) return json(200, { ok: true, mode: 'preview', configured: !!c.key, plan, note: 'add &apply=1 to create it (charges once live). Preview needs no key.' });
  if (!c.key) return json(200, { ok: false, configured: false, error: 'OPENAI_ADS_API_KEY not vaulted', plan });

  // 1) campaign — the documented body shape.
  const camp = await oa.api('POST', '/campaigns', c.key, campaignBody);
  if (!camp.ok) return json(200, { ok: false, step: 'campaign', error: camp.err, plan });
  const campaignId = (camp.d && (camp.d.id || (camp.d.campaign && camp.d.campaign.id))) || null;

  // 2) ad group — best-effort documented shape; field names tuned on first real call.
  const agBody = { campaign_id: campaignId, name: `${kit.label} ad group`, status: 'active', targeting: { locations: cities } };
  const ag = await oa.api('POST', '/ad_groups', c.key, agBody);
  const adGroupId = ag.ok ? ((ag.d && (ag.d.id || (ag.d.ad_group && ag.d.ad_group.id))) || null) : null;

  // 3) ad — creative field names likewise finalized on first real call.
  let ad = { ok: false, err: 'skipped — no ad_group' };
  if (adGroupId) {
    const adBody = { ad_group_id: adGroupId, status: 'active', final_url: kit.final, headlines: kit.headlines, descriptions: kit.descriptions };
    ad = await oa.api('POST', '/ads', c.key, adBody);
  }

  return json(200, {
    ok: !!camp.ok, mode: 'created', campaign_id: campaignId,
    campaign: { ok: camp.ok, id: campaignId },
    ad_group: { ok: ag.ok, id: adGroupId, err: ag.err || null },
    ad: { ok: ad.ok, err: ad.err || null },
    plan,
    note: (ag.ok && ad.ok) ? 'live' : 'campaign created; ad-group/ad shapes need tuning against the live API response (see err).',
  });
};
