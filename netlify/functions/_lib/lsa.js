// lsa — Local Services Ads reporting connector. Reuses the Google Ads OAuth
// (same refresh token + developer token + manager account) — no new auth.
// Pulls account-level LSA reports (budget, charged leads, total cost). Lead-level
// detail now comes through the Google Ads API (Google moved it there).
//   accountReports(days) -> { ok, status, accounts:[...] }
'use strict';
const { creds, accessToken } = require('./google-ads');
const BASE = 'https://localservices.googleapis.com/v1';

function ymd(d) { return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate() }; }

async function accountReports(days) {
  const c = await creds();
  if (!c.refresh || !c.devToken || !c.managerId) return { ok: false, configured: false, missing: ['refresh', 'devToken', 'managerId'].filter((k) => !c[k]) };
  const token = await accessToken(c);
  const end = new Date();
  const start = new Date(end.getTime() - (days || 30) * 86400000);
  const s = ymd(start), e = ymd(end);
  // accountReports.search: the `query` is ONLY the account filter
  // (semicolon-separated field:value), and the date range is SEPARATE URL params
  // (startDate.year/month/day, endDate.*). Putting dates or AND in the query is
  // what triggered "No manager_customer_id provided".
  const q = `manager_customer_id:${c.managerId}`;
  const params = new URLSearchParams();
  params.set('query', q);
  params.set('startDate.year', String(s.y));
  params.set('startDate.month', String(s.m));
  params.set('startDate.day', String(s.day));
  params.set('endDate.year', String(e.y));
  params.set('endDate.month', String(e.m));
  params.set('endDate.day', String(e.day));
  params.set('pageSize', '50');
  // keep the field:value colon literal (encoded %3A makes the parser miss the field)
  const url = `${BASE}/accountReports:search?${params.toString().replace(/%3A/g, ':')}`;
  const headers = { Authorization: 'Bearer ' + token, 'developer-token': c.devToken };
  let r, d;
  try { r = await fetch(url, { headers }); d = await r.json().catch(() => ({})); } catch (err) { return { ok: false, error: String(err.message || err) }; }
  if (!r.ok) return { ok: false, status: r.status, error: (d.error && (d.error.message || d.error.status)) || d, manager_id: c.managerId };
  const accounts = (d.accountReports || []).map((a) => ({
    account_id: a.accountId, business: a.businessName,
    avg_weekly_budget: a.averageWeeklyBudget,
    total_charged_leads: a.totalChargedLeads,
    total_charged_cost: a.currentPeriodChargedCost || a.totalChargedCost,
    reviews: a.numberOfReviews, avg_rating: a.averageFiveStarRating,
    phone_leads: a.phoneLeadResponsiveness, raw: a,
  }));
  return { ok: true, status: r.status, days: days || 30, accounts };
}

module.exports = { accountReports };
