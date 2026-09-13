// lsa — Local Services Ads reporting.
//
// 2026-09-13: this connector reported "no LSA account" for months and it was wrong.
// It only ever asked the Local Services `accountReports.search` endpoint, filtered by
// GOOGLE_ADS_MANAGER_ID — and that endpoint answers 200 with an empty list both when an
// account has no billed leads AND when the account simply is not under the manager you
// asked about. Those are opposite problems (wait, vs. go look somewhere else) and the
// empty list hides which one you have.
//
// The LSA account is its OWN customer (8532272803), separate from the Search account
// (9267688121) and not under any manager this token can reach. Nothing was broken except
// where we were looking. Google moved LSA lead detail into the Google Ads API, so ask
// THERE — against the LSA customer — and the leads are all sitting right there.
//
//   report(days) -> { ok, cid, campaign, leads:{...}, cost_per_lead }
//   accountReports(days) -> legacy Local Services endpoint (kept; rarely populated)
'use strict';
const { creds, accessToken, apiHeaders } = require('./google-ads');
const { getSecret } = require('./secrets');
const BASE = 'https://localservices.googleapis.com/v1';

function ymd(d) { return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate() }; }

async function gaql(token, c, cid, query) {
  const url = `https://googleads.googleapis.com/${c.version}/customers/${cid}/googleAds:search`;
  const run = (login) => fetch(url, { method: 'POST', headers: apiHeaders(token, c, login), body: JSON.stringify({ query }) });
  let r = await run(cid);
  if (!r.ok && r.status === 403 && c.managerId) r = await run(c.managerId);
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, results: d.results || [], error: d.error };
}

// Find the customer that actually owns the Local Services campaign. Cached in the vault
// so the discovery walk only happens once, but never REQUIRED - a wrong/stale id just
// costs one extra probe.
async function lsaCid(token, c) {
  const pinned = String((await getSecret('GOOGLE_ADS_LSA_CID')) || '').replace(/\D/g, '');
  const candidates = [];
  if (pinned) candidates.push(pinned);
  try {
    const r = await fetch(`https://googleads.googleapis.com/${c.version}/customers:listAccessibleCustomers`, {
      headers: { Authorization: 'Bearer ' + token, 'developer-token': c.devToken },
    });
    const d = await r.json().catch(() => ({}));
    for (const n of (d.resourceNames || [])) { const id = String(n).split('/').pop(); if (!candidates.includes(id)) candidates.push(id); }
  } catch (_) {}
  for (const cid of candidates) {
    const q = await gaql(token, c, cid, "SELECT campaign.id FROM campaign WHERE campaign.advertising_channel_type = 'LOCAL_SERVICES' AND campaign.status != 'REMOVED'");
    if (q.ok && q.results.length) return { cid, discovered: cid !== pinned };
  }
  return { cid: null, tried: candidates };
}

async function report(days) {
  const c = await creds();
  if (!c.refresh || !c.devToken) return { ok: false, configured: false };
  const token = await accessToken(c);
  const found = await lsaCid(token, c);
  if (!found.cid) return { ok: true, found: false, tried: found.tried, note: 'No customer reachable by this token runs a LOCAL_SERVICES campaign.' };
  const cid = found.cid;
  const win = (days || 30) <= 7 ? 'LAST_7_DAYS' : (days || 30) <= 14 ? 'LAST_14_DAYS' : 'LAST_30_DAYS';

  const camp = await gaql(token, c, cid, `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, metrics.cost_micros FROM campaign WHERE campaign.advertising_channel_type = 'LOCAL_SERVICES' AND segments.date DURING ${win}`);
  const row = camp.results[0] || {};
  const cost = Math.round((Number(row.metrics?.costMicros || 0) / 1e6) * 100) / 100;

  // Leads carry no date filter here on purpose: segments.date is rejected on this
  // resource, so pull them all and window them in code.
  const lead = await gaql(token, c, cid, 'SELECT local_services_lead.id, local_services_lead.lead_status, local_services_lead.lead_type, local_services_lead.creation_date_time, local_services_lead.lead_charged FROM local_services_lead');
  const since = Date.now() - (days || 30) * 86400000;
  const byStatus = {}, byType = {}, byDay = {};
  let inWindow = 0, charged = 0;
  for (const r of lead.results) {
    const l = r.localServicesLead || {};
    const t = Date.parse(String(l.creationDateTime || '').replace(' ', 'T')) || 0;
    if (!t || t < since) continue;
    inWindow++;
    if (l.leadCharged === true) charged++;
    byStatus[l.leadStatus || '?'] = (byStatus[l.leadStatus || '?'] || 0) + 1;
    byType[l.leadType || '?'] = (byType[l.leadType || '?'] || 0) + 1;
    const d = String(l.creationDateTime || '').slice(0, 10);
    if (d) byDay[d] = (byDay[d] || 0) + 1;
  }
  return {
    ok: true, found: true, cid, discovered: found.discovered, days: days || 30, window: win,
    campaign: { name: row.campaign?.name, status: row.campaign?.status, daily_budget: Math.round((Number(row.campaignBudget?.amountMicros || 0) / 1e6) * 100) / 100 },
    cost, leads: { total_all_time: lead.results.length, in_window: inWindow, charged, by_status: byStatus, by_type: byType, by_day: byDay },
    cost_per_lead: inWindow ? Math.round((cost / inWindow) * 100) / 100 : null,
    note: 'LSA contact details are not exposed by the API, so a lead cannot be auto-matched to a job the way the ads-line calls can. Count and cost are real.',
  };
}

// Legacy Local Services endpoint. Kept because it carries review count / responsiveness,
// but it only answers for accounts under a manager we can reach - which the LSA account
// is not, so it is usually empty. report() is the one to trust.
async function accountReports(days) {
  const c = await creds();
  if (!c.refresh || !c.devToken || !c.managerId) return { ok: false, configured: false };
  const token = await accessToken(c);
  const end = new Date(); const start = new Date(end.getTime() - (days || 30) * 86400000);
  const s = ymd(start), e = ymd(end);
  const p = new URLSearchParams();
  p.set('query', `manager_customer_id:${c.managerId}`);
  p.set('startDate.year', String(s.y)); p.set('startDate.month', String(s.m)); p.set('startDate.day', String(s.day));
  p.set('endDate.year', String(e.y)); p.set('endDate.month', String(e.m)); p.set('endDate.day', String(e.day));
  p.set('pageSize', '50');
  const url = `${BASE}/accountReports:search?${p.toString().replace(/%3A/g, ':')}`;
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, 'developer-token': c.devToken } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: (d.error && (d.error.message || d.error.status)) || d };
    return { ok: true, status: r.status, accounts: (d.accountReports || []) };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
}

module.exports = { report, accountReports };
