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
  const q = `manager_customer_id:${c.managerId}`
    + ` AND start_date_range.year:${s.y} AND start_date_range.month:${s.m} AND start_date_range.day:${s.day}`
    + ` AND end_date_range.year:${e.y} AND end_date_range.month:${e.m} AND end_date_range.day:${e.day}`;
  // keep the colons literal — the LSA query parser wants field:value, and an
  // encoded %3A makes it miss the fields ("No manager_customer_id provided").
  const url = `${BASE}/accountReports:search?query=${encodeURIComponent(q).replace(/%3A/g, ':')}&pageSize=50`;
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
