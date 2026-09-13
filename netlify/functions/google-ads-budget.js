// google-ads-budget — read every live budget in one place, and set the Search side.
//
// WHY THIS EXISTS: the two paid channels are billed in different places and only one of
// them can be written by API. Before this, answering "what is our daily budget?" meant
// opening two dashboards. Now it is one call.
//
//   Search (cid 9267688121) — campaign_budget.amount_micros. WRITABLE here.
//   LSA    (cid 8532272803) — reported read-only. Google exposes NO write API for Local
//                             Services budget/hours/on-off. That is a dashboard-only
//                             change, for everyone, not a gap in our connector.
//
// PREVIEW BY DEFAULT. &apply=1 writes. The write is guarded three ways, because a
// mis-set budget spends real money every hour until someone notices:
//   1. a sane-range refusal (a fat-fingered 4286 can never become $4,286/day)
//   2. partialFailure OFF + sent-vs-applied count compare (the guard the wiped
//      ad-schedule incident earned)
//   3. a read-back — the new amount is proven off the account, not off the 200
//
//   GET ?secret=<admin>                         -> read both channels, change nothing
//   GET ?secret=<admin>&daily=42.86&apply=1     -> set every ENABLED Search campaign
//   GET ?secret=<admin>&campaign=<id>&daily=..  -> scope to one campaign
'use strict';

const { getSecret } = require('./_lib/secrets');
const ads = require('./_lib/google-ads');

// A local appliance shop does not run a $500/day search budget. Anything outside this is
// a typo, and a typo here is billed by the hour.
const MIN_DAILY = 1;
const MAX_DAILY = 500;

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function usd(micros) { return Math.round((Number(micros || 0) / 1e6) * 100) / 100; }

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'admin secret required (?secret=)' });

  const apply = q.apply === '1';
  const onlyCampaign = String(q.campaign || '').replace(/\D/g, '');
  const wantDaily = q.daily === undefined || q.daily === '' ? null : Number(q.daily);

  const c = await ads.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, configured: false });
  const token = await ads.accessToken(c);
  const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
  const base = `https://googleads.googleapis.com/${c.version}/customers/${cid}`;

  async function call(path, body, login) {
    const r = await fetch(base + path, { method: 'POST', headers: ads.apiHeaders(token, c, login || cid), body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && r.status === 403 && c.managerId && !login) return call(path, body, c.managerId);
    return { ok: r.ok, status: r.status, d };
  }

  // ---- read the Search side -------------------------------------------------
  const sel = await call('/googleAds:search', {
    query: 'SELECT campaign.id, campaign.name, campaign.status, campaign_budget.id, ' +
           'campaign_budget.amount_micros, campaign_budget.explicitly_shared ' +
           "FROM campaign WHERE campaign.status = 'ENABLED'",
  });
  if (!sel.ok) return json(200, { ok: false, error: 'could not read campaigns', status: sel.status, detail: sel.d.error || sel.d });

  let enabled = (sel.d.results || []).map((r) => ({
    id: r.campaign.id,
    name: r.campaign.name,
    status: r.campaign.status,
    budget_id: r.campaignBudget.id,
    budget_resource: r.campaignBudget.resourceName,
    daily_usd: usd(r.campaignBudget.amountMicros),
    shared: !!r.campaignBudget.explicitlyShared,
  }));
  if (onlyCampaign) enabled = enabled.filter((e) => e.id === onlyCampaign);

  const searchDaily = Math.round(enabled.reduce((s, e) => s + e.daily_usd, 0) * 100) / 100;

  // ---- read the LSA side (read-only, separate customer) ----------------------
  let lsa = { writable: false, note: 'Google exposes no write API for Local Services budget. Dashboard only.' };
  try {
    const l = require('./_lib/lsa');
    const rep = await l.report(30);
    if (rep && rep.campaign) {
      lsa.daily_usd = rep.campaign.daily_budget;
      lsa.weekly_usd = Math.round(rep.campaign.daily_budget * 7 * 100) / 100;
      lsa.status = rep.campaign.status;
      lsa.spend_30d = rep.cost;
      lsa.actual_daily = Math.round((rep.cost / 30) * 100) / 100;
      lsa.utilization_pct = Math.round((rep.cost / 30 / rep.campaign.daily_budget) * 1000) / 10;
      lsa.cost_per_lead = rep.cost_per_lead;
    }
  } catch (e) { lsa.error = String(e && e.message || e); }

  const combined = Math.round((searchDaily + (lsa.daily_usd || 0)) * 100) / 100;
  const snapshot = {
    search: { daily_usd: searchDaily, campaigns: enabled, writable: true },
    lsa,
    combined_daily_usd: combined,
    even_split_each: Math.round((combined / 2) * 100) / 100,
  };

  if (wantDaily === null) {
    return json(200, { ok: true, mode: 'read', snapshot, note: 'pass &daily=<usd>&apply=1 to set the Search side' });
  }
  if (!Number.isFinite(wantDaily) || wantDaily < MIN_DAILY || wantDaily > MAX_DAILY) {
    return json(200, { ok: false, error: `daily must be between $${MIN_DAILY} and $${MAX_DAILY}`, got: q.daily });
  }
  if (!enabled.length) return json(200, { ok: false, error: 'no enabled campaign matched', campaign: onlyCampaign || '(any)' });

  const micros = Math.round(wantDaily * 1e6);
  const plan = enabled.map((e) => ({ campaign: e.name, id: e.id, from_usd: e.daily_usd, to_usd: wantDaily }));
  if (!apply) return json(200, { ok: true, mode: 'preview', snapshot, plan, note: 'add &apply=1 to write' });

  // A shared budget feeds campaigns we did not select. Refuse rather than move money
  // under a campaign nobody asked about.
  const shared = enabled.filter((e) => e.shared);
  if (shared.length) {
    return json(200, { ok: false, error: 'refusing to write a shared budget', shared: shared.map((s) => s.name), note: 'a shared budget also funds campaigns outside this selection' });
  }

  const ops = enabled.map((e) => ({
    update: { resourceName: e.budget_resource, amountMicros: String(micros) },
    updateMask: 'amount_micros',
  }));
  const res = await call('/campaignBudgets:mutate', { operations: ops, partialFailure: false });
  const applied = (res.d.results || []).length;
  if (!res.ok || applied !== ops.length) {
    return json(200, { ok: false, error: 'mutate did not apply', sent: ops.length, applied, status: res.status, detail: res.d.error || res.d });
  }

  // Prove it off the account, not off the 200.
  const ids = enabled.map((e) => e.id).join(',');
  const after = await call('/googleAds:search', {
    query: `SELECT campaign.id, campaign.name, campaign_budget.amount_micros FROM campaign WHERE campaign.id IN (${ids})`,
  });
  const verified = (after.d.results || []).map((r) => ({ id: r.campaign.id, name: r.campaign.name, daily_usd: usd(r.campaignBudget.amountMicros) }));
  const allGood = verified.length === enabled.length && verified.every((v) => v.daily_usd === wantDaily);

  return json(200, {
    ok: allGood,
    mode: 'applied',
    plan,
    verified_now: verified,
    lsa_reminder: lsa.writable === false
      ? `LSA is unchanged at $${lsa.daily_usd}/day ($${lsa.weekly_usd}/wk). It has no write API - set it at ads.google.com/localservices.`
      : undefined,
    note: allGood ? 'Budget set and read back clean.' : 'WRITE REPORTED OK BUT READ-BACK DISAGREES — check the account.',
  });
};
