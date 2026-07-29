// google-ads-keyword-volumes — real monthly search volumes per language via
// Keyword Planner (KeywordPlanIdeaService.generateKeywordHistoricalMetrics).
// Pulls in-language appliance-repair queries at local (TN+LA) and US geo.
//   GET ?secret=<admin>[&lang=es|vi|ru|ar|zh|hi|fr|all][&geo=local|us|both]
const ga = require('./_lib/google-ads');
const { getSecret } = require('./_lib/secrets');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(b, null, 2) }; }

// Google Ads languageConstant criterion IDs
const LANG = {
  es: { id: 1003, name: 'Spanish' },
  vi: { id: 1040, name: 'Vietnamese' },
  ru: { id: 1031, name: 'Russian' },
  ar: { id: 1019, name: 'Arabic' },
  zh: { id: 1017, name: 'Chinese (simplified)' },
  hi: { id: 1023, name: 'Hindi' },
  fr: { id: 1002, name: 'French' },
};
// geoTargetConstants: TN=21175, LA=21148, US=2840
const GEO = { local: ['21175', '21148'], us: ['2840'] };

const KW = {
  es: ['reparación de refrigeradores', 'reparación de lavadoras', 'reparación de secadoras', 'reparación de estufas', 'reparación de lavavajillas', 'reparación de electrodomésticos', 'técnico de refrigeradores cerca de mí', 'reparación de neveras'],
  vi: ['sửa tủ lạnh', 'sửa máy giặt', 'sửa máy sấy', 'sửa máy rửa chén', 'sửa chữa thiết bị gia dụng', 'thợ sửa tủ lạnh', 'sửa bếp'],
  ru: ['ремонт холодильников', 'ремонт стиральных машин', 'ремонт сушильных машин', 'ремонт посудомоечных машин', 'ремонт бытовой техники', 'мастер по ремонту холодильников'],
  ar: ['تصليح ثلاجات', 'تصليح غسالات', 'تصليح الأجهزة المنزلية', 'فني تصليح ثلاجات', 'صيانة ثلاجات', 'تصليح غسالة أطباق'],
  zh: ['冰箱维修', '洗衣机维修', '烘干机维修', '洗碗机维修', '家电维修', '冰箱维修 附近'],
  hi: ['फ्रिज रिपेयर', 'वॉशिंग मशीन रिपेयर', 'फ्रिज मरम्मत', 'उपकरण रिपेयर', 'वॉशिंग मशीन मरम्मत'],
  fr: ['réparation réfrigérateur', 'réparation lave-linge', 'réparation sèche-linge', 'réparation lave-vaisselle', 'réparation électroménager', 'dépannage réfrigérateur'],
};

async function metrics(cid, c, token, langId, keywords, geos, loginCid) {
  const url = `https://googleads.googleapis.com/${c.version}/customers/${cid}:generateKeywordHistoricalMetrics`;
  const body = {
    keywords,
    language: 'languageConstants/' + langId,
    geoTargetConstants: geos.map((g) => 'geoTargetConstants/' + g),
    keywordPlanNetwork: 'GOOGLE_SEARCH',
    includeAdultKeywords: false,
  };
  // Keyword Planner is picky about login-customer-id — try manager, then the
  // account itself, then no login header; use whichever the API accepts.
  const ladder = loginCid != null ? [loginCid] : [c.managerId, cid, ''];
  let r, d;
  for (const lc of ladder) {
    r = await fetch(url, { method: 'POST', headers: ga.apiHeaders(token, c, lc), body: JSON.stringify(body) });
    d = await r.json().catch(() => ({}));
    if (r.ok) { d._login = lc || '(none)'; break; }
    if (r.status !== 403 && r.status !== 401) break; // only fall through on auth errors
  }
  if (!r.ok) return { ok: false, status: r.status, error: (d.error && (d.error.message || d.error.status)) || d };
  const rows = (d.results || []).map((x) => ({
    kw: x.text,
    monthly: parseInt((x.keywordMetrics && x.keywordMetrics.avgMonthlySearches) || 0, 10) || 0,
    competition: (x.keywordMetrics && x.keywordMetrics.competition) || 'UNSPECIFIED',
  })).sort((a, b) => b.monthly - a.monthly);
  const total = rows.reduce((s, x) => s + x.monthly, 0);
  return { ok: true, login_used: d._login, total, rows };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const c = await ga.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, error: 'Google Ads not configured (client/refresh/dev token missing)' });
  const cid = String((await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121').replace(/\D/g, '');

  let token;
  try { token = await ga.accessToken(c); } catch (e) { return json(200, { ok: false, error: 'token: ' + String(e.message || e) }); }

  const langs = q.lang && q.lang !== 'all' && LANG[q.lang] ? [q.lang] : Object.keys(LANG);
  const geoMode = q.geo || 'both';
  const out = {};
  const grand = { local: 0, us: 0 };

  for (const lk of langs) {
    const L = LANG[lk];
    const rec = { language: L.name };
    if (geoMode === 'local' || geoMode === 'both') {
      rec.local = await metrics(cid, c, token, L.id, KW[lk], GEO.local);
      if (rec.local.ok) grand.local += rec.local.total;
    }
    if (geoMode === 'us' || geoMode === 'both') {
      rec.us = await metrics(cid, c, token, L.id, KW[lk], GEO.us);
      if (rec.us.ok) grand.us += rec.us.total;
    }
    out[lk] = rec;
  }

  return json(200, {
    ok: true, customer_id: cid, api_version: c.version,
    note: 'avgMonthlySearches from Google Keyword Planner. local = Tennessee + Louisiana; us = nationwide.',
    grand_total_monthly: grand, by_language: out,
  });
};
