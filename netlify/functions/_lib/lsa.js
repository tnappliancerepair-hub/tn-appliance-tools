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

// Which manager actually owns the LSA account? The connector has always asked exactly
// one (GOOGLE_ADS_MANAGER_ID) and taken an empty answer as "no leads yet" — but a 200
// with zero accountReports means the SAME thing whether the account has no data or is
// simply not under that manager. Those are opposite problems (wait vs. link it), so
// probe every manager the token can reach and say which it is.
async function diagnose(days) {
  const c = await creds();
  if (!c.refresh || !c.devToken) return { ok: false, configured: false };
  const token = await accessToken(c);

  // Every customer this OAuth token can see — the LSA account, if linked at all, is
  // reachable from one of these.
  let reachable = [];
  try {
    const r = await fetch('https://googleads.googleapis.com/' + c.version + '/customers:listAccessibleCustomers', {
      headers: { Authorization: 'Bearer ' + token, 'developer-token': c.devToken },
    });
    const d = await r.json().catch(() => ({}));
    reachable = (d.resourceNames || []).map((x) => String(x).split('/').pop());
  } catch (_) {}

  const candidates = [...new Set([c.managerId, ...reachable].filter(Boolean))];
  const tried = [];
  for (const mid of candidates) {
    const res = await rawReports(token, c, mid, days || 30);
    tried.push({ manager_id: mid, http: res.status, accounts: (res.body.accountReports || []).length, error: res.body.error ? (res.body.error.message || res.body.error.status) : undefined });
    if ((res.body.accountReports || []).length) {
      return { ok: true, found: true, manager_id: mid, accounts: res.body.accountReports, reachable, tried };
    }
  }
  return { ok: true, found: false, reachable, tried, configured_manager: c.managerId,
    verdict: 'No LSA account is visible from any manager this token can reach. LSA reports only CHARGED leads, so a freshly enabled account with no billed lead yet also reads empty — but if it stays empty for a few days the account is not linked to a manager the API can see.' };
}

// One raw call, so diagnose() can compare managers without the mapping in between.
async function rawReports(token, c, managerId, days) {
  const end = new Date();
  const start = new Date(end.getTime() - (days || 30) * 86400000);
  const s = ymd(start), e = ymd(end);
  const params = new URLSearchParams();
  params.set('query', `manager_customer_id:${managerId}`);
  params.set('startDate.year', String(s.y)); params.set('startDate.month', String(s.m)); params.set('startDate.day', String(s.day));
  params.set('endDate.year', String(e.y)); params.set('endDate.month', String(e.m)); params.set('endDate.day', String(e.day));
  params.set('pageSize', '50');
  const url = `${BASE}/accountReports:search?${params.toString().replace(/%3A/g, ':')}`;
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, 'developer-token': c.devToken } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } catch (err) { return { status: 0, body: { error: { message: String(err.message || err) } } }; }
}

module.exports = { accountReports, diagnose };
