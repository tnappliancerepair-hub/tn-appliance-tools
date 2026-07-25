// market-finder — pulls REAL monthly search volume from Google Keyword Planner
// (Ads API) for our core appliance-repair services, per metro, in Spanish and/or
// English. Answers "where is the demand + where is it least competed" so we know
// which cities to build Spanish landers for next. Owner-gated.
//
//   GET ?secret=<admin>              → ranked metros (Spanish, default)
//        &lang=es|en|both            → which language demand (default es)
//        &metros=Miami, FL|Houston, TX  (| or ; separated; else the default list)
//        &format=json|html           (default json)
//
// How it works: one geo-suggest call resolves every metro name → its Keyword
// Planner geo id; then one historical-metrics call per metro sums the avg monthly
// searches across our seed keywords. Competition index (0-100) is averaged so you
// see demand AND how contested it is — first-mover targets = high volume, low comp.
'use strict';
const ga = require('./_lib/google-ads');
const { getSecret, getSecretPreferVault } = require('./_lib/secrets');

function json(c, o) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
function html(c, s) { return { statusCode: c, headers: { 'content-type': 'text/html; charset=utf-8' }, body: s }; }

// Seed keywords — what our customers actually type.
const TERMS = {
  es: ['reparacion de electrodomesticos', 'reparacion de lavadora', 'reparacion de secadora', 'reparacion de refrigerador', 'reparacion de nevera', 'reparacion de lavavajillas', 'reparacion de estufa', 'tecnico de electrodomesticos'],
  en: ['appliance repair', 'appliance repair near me', 'washer repair', 'dryer repair', 'refrigerator repair', 'dishwasher repair', 'oven repair', 'appliance technician'],
};
const LANG_CONST = { es: 'languageConstants/1003', en: 'languageConstants/1000' };

// Default target list — the big Spanish-speaking metros + our home base for comparison.
const DEFAULT_METROS = [
  'Miami, Florida', 'Houston, Texas', 'San Antonio, Texas', 'Dallas, Texas', 'Los Angeles, California',
  'Phoenix, Arizona', 'El Paso, Texas', 'Chicago, Illinois', 'Orlando, Florida', 'Tampa, Florida',
  'Las Vegas, Nevada', 'McAllen, Texas', 'Riverside, California', 'Fresno, California', 'San Diego, California',
  'Denver, Colorado', 'Atlanta, Georgia', 'New York, New York',
  'Nashville, Tennessee', 'New Orleans, Louisiana',
];

async function suggestGeos(token, c, names) {
  const url = 'https://googleads.googleapis.com/' + c.version + '/geoTargetConstants:suggest';
  const body = { locale: 'en', countryCode: 'US', locationNames: { names } };
  const r = await fetch(url, { method: 'POST', headers: ga.apiHeaders(token, c), body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('geo-suggest ' + r.status + ': ' + JSON.stringify(d).slice(0, 300));
  const out = {};
  const rank = { Metro: 3, City: 2, Region: 1 };
  for (const s of (d.geoTargetConstantSuggestions || [])) {
    const g = s.geoTargetConstant || {};
    const key = (s.searchTerm || g.name || '').trim();
    if (!key) continue;
    const cur = out[key];
    const score = rank[g.targetType] || 0;
    if (!cur || score > cur.score) out[key] = { resourceName: g.resourceName, name: g.name, targetType: g.targetType, score };
  }
  return out;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function metricsFor(token, c, customerId, keywords, geoResource, langConst) {
  const url = 'https://googleads.googleapis.com/' + c.version + '/customers/' + customerId + ':generateKeywordHistoricalMetrics';
  const body = { keywords, geoTargetConstants: [geoResource], keywordPlanNetwork: 'GOOGLE_SEARCH', language: langConst, historicalMetricsOptions: { includeAverageCpc: true } };
  // login-customer-id = the account itself (mirrors the working Ads functions); on
  // 403 fall back to the manager id; on 429 (per-minute quota) wait + retry once.
  let r, d;
  for (let attempt = 0; attempt < 2; attempt++) {
    r = await fetch(url, { method: 'POST', headers: ga.apiHeaders(token, c, customerId), body: JSON.stringify(body) });
    d = await r.json().catch(() => ({}));
    if (!r.ok && r.status === 403 && c.managerId) {
      r = await fetch(url, { method: 'POST', headers: ga.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) });
      d = await r.json().catch(() => ({}));
    }
    if (r.status === 429 && attempt === 0) { await sleep(4000); continue; }
    break;
  }
  if (!r.ok) return { ok: false, status: r.status, error: JSON.stringify(d).slice(0, 900) };
  let total = 0, compSum = 0, compN = 0, top = null, topV = -1;
  const COMP = { LOW: 25, MEDIUM: 55, HIGH: 85 };
  for (const res of (d.results || [])) {
    const m = res.keywordMetrics || {};
    const v = Number(m.avgMonthlySearches || 0);
    total += v;
    if (m.competition && COMP[m.competition] != null) { compSum += (m.competitionIndex != null ? Number(m.competitionIndex) : COMP[m.competition]); compN++; }
    else if (m.competitionIndex != null) { compSum += Number(m.competitionIndex); compN++; }
    if (v > topV) { topV = v; top = res.text; }
  }
  return { ok: true, total, comp: compN ? Math.round(compSum / compN) : null, top, topV };
}

async function runLang(token, c, customerId, geos, metros, lang) {
  const kws = TERMS[lang];
  const langConst = LANG_CONST[lang];
  const rows = [];
  for (const m of metros) {
    const g = geos[m] || geos[m.split(',')[0].trim()];
    if (!g) { rows.push({ metro: m, error: 'no geo match' }); continue; }
    const r = await metricsFor(token, c, customerId, kws, g.resourceName, langConst);
    if (!r.ok) { rows.push({ metro: m, error: r.error }); }
    else rows.push({ metro: m, geo: g.name, total_monthly_searches: r.total, competition: r.comp, top_term: r.top, top_term_volume: r.topV });
    await sleep(900); // stay under Keyword Planner per-minute quota
  }
  rows.sort((a, b) => (b.total_monthly_searches || 0) - (a.total_monthly_searches || 0));
  return rows;
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const langReq = (q.lang || 'es').toLowerCase();
  const langs = langReq === 'both' ? ['es', 'en'] : [langReq === 'en' ? 'en' : 'es'];
  const max = Math.max(1, Math.min(20, parseInt(q.max, 10) || 12)); // fit the 26s sync window + quota
  let metros = (q.metros || '').trim() ? q.metros.split(/[|;]/).map((s) => s.trim()).filter(Boolean) : DEFAULT_METROS;
  metros = metros.slice(0, max);

  const c = await ga.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, error: 'google ads not configured' });
  const customerId = String((await getSecretPreferVault('GOOGLE_ADS_CUSTOMER_ID')) || '9267688121').replace(/\D/g, '');

  let token;
  try { token = await ga.accessToken(c); } catch (e) { return json(200, { ok: false, error: 'auth: ' + String((e && e.message) || e) }); }

  // ?keywords=a|b|c  → national (US) per-keyword monthly volume. Answers "what
  // symptom/how-to terms are people searching" — the seed list for the knowledge base.
  if ((q.keywords || '').trim()) {
    const kws = q.keywords.split(/[|;]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const langConst = LANG_CONST[langReq === 'es' && q.lang === 'es' ? 'es' : 'en'];
    const US = 'geoTargetConstants/2840';
    const url = 'https://googleads.googleapis.com/' + c.version + '/customers/' + customerId + ':generateKeywordHistoricalMetrics';
    const body = { keywords: kws, geoTargetConstants: [US], keywordPlanNetwork: 'GOOGLE_SEARCH', language: langConst, historicalMetricsOptions: { includeAverageCpc: true } };
    let r = await fetch(url, { method: 'POST', headers: ga.apiHeaders(token, c, customerId), body: JSON.stringify(body) });
    let d = await r.json().catch(() => ({}));
    if (!r.ok && r.status === 403 && c.managerId) { r = await fetch(url, { method: 'POST', headers: ga.apiHeaders(token, c, c.managerId), body: JSON.stringify(body) }); d = await r.json().catch(() => ({})); }
    if (!r.ok) return json(200, { ok: false, error: JSON.stringify(d).slice(0, 600) });
    const rows = (d.results || []).map((res) => ({ term: res.text, monthly_searches: Number((res.keywordMetrics || {}).avgMonthlySearches || 0), competition: (res.keywordMetrics || {}).competition || null, competition_index: (res.keywordMetrics || {}).competitionIndex != null ? Number(res.keywordMetrics.competitionIndex) : null }));
    rows.sort((a, b) => b.monthly_searches - a.monthly_searches);
    return json(200, { ok: true, scope: 'US national', language: langConst, keywords: rows });
  }

  let geos;
  try { geos = await suggestGeos(token, c, metros); } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }

  const result = {};
  for (const lang of langs) result[lang] = await runLang(token, c, customerId, geos, metros, lang);

  if (q.format === 'html') {
    const lang = langs[0];
    const rows = result[lang] || [];
    const tr = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.metro}</td><td style="text-align:right">${r.error ? '—' : (r.total_monthly_searches || 0).toLocaleString()}</td><td style="text-align:right">${r.competition == null ? '—' : r.competition}</td><td>${r.error || r.top_term || ''}</td></tr>`).join('');
    return html(200, `<!doctype html><meta charset=utf-8><title>Market Finder</title><style>body{font-family:system-ui;background:#0b0b0b;color:#eee;padding:24px}table{border-collapse:collapse;width:100%;max-width:760px}th,td{padding:8px 10px;border-bottom:1px solid #333;font-size:14px}th{text-align:left;color:#ff8c42}h1{font-size:20px}.n{color:#8a8a8a}</style><h1>🐜 Market Finder — ${lang === 'es' ? 'Spanish' : 'English'} demand</h1><p class=n>Monthly searches for our appliance-repair services, by metro. Comp = competition 0-100 (lower = easier to rank/cheaper ads).</p><table><tr><th>#</th><th>Metro</th><th>Monthly searches</th><th>Comp</th><th>Top term</th></tr>${tr}</table>`);
  }
  return json(200, { ok: true, langs, customerId, metros_count: metros.length, results: result });
};
