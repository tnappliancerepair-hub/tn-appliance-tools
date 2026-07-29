// google-ads-keyword-universe — the FULL in-language search universe per language.
// Uses KeywordPlanIdeaService.generateKeywordIdeas: we give ~10 in-language seed
// terms, Google expands to every related query real people search + volumes.
//   GET ?secret=<admin>&lang=es|vi|ru|ar|zh|hi|fr [&geo=us|local] [&pages=4] [&top=30]
const ga = require('./_lib/google-ads');
const { getSecret } = require('./_lib/secrets');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(b, null, 2) }; }

const LANG = {
  es: { id: 1003, name: 'Spanish' }, vi: { id: 1040, name: 'Vietnamese' },
  ru: { id: 1031, name: 'Russian' }, ar: { id: 1019, name: 'Arabic' },
  zh: { id: 1017, name: 'Chinese (simplified)' }, hi: { id: 1023, name: 'Hindi' },
  fr: { id: 1002, name: 'French' },
};
const GEO = { local: ['21175', '21148'], us: ['2840'] };

// ~10 in-language seeds per language (appliances + repair intent + a symptom). Google expands these.
const SEED = {
  es: ['reparación de refrigeradores', 'reparación de lavadoras', 'reparación de secadoras', 'reparación de estufas', 'reparación de lavavajillas', 'reparación de electrodomésticos', 'técnico de electrodomésticos', 'reparación de neveras', 'refrigerador no enfría', 'lavadora no centrifuga'],
  vi: ['sửa tủ lạnh', 'sửa máy giặt', 'sửa máy sấy', 'sửa máy rửa chén', 'sửa chữa thiết bị gia dụng', 'thợ sửa tủ lạnh', 'sửa bếp', 'tủ lạnh không lạnh', 'sửa lò vi sóng'],
  ru: ['ремонт холодильников', 'ремонт стиральных машин', 'ремонт бытовой техники', 'ремонт посудомоечных машин', 'ремонт сушильных машин', 'мастер по ремонту холодильников', 'холодильник не морозит', 'стиральная машина не сливает', 'ремонт плит'],
  ar: ['تصليح ثلاجات', 'تصليح غسالات', 'تصليح الأجهزة المنزلية', 'صيانة ثلاجات', 'تصليح غسالة أطباق', 'فني تصليح ثلاجات', 'تصليح مجفف', 'الثلاجة لا تبرد'],
  zh: ['冰箱维修', '洗衣机维修', '家电维修', '烘干机维修', '洗碗机维修', '冰箱不制冷', '烤箱维修', '维修师傅', '洗衣机不排水'],
  hi: ['फ्रिज रिपेयर', 'वॉशिंग मशीन रिपेयर', 'फ्रिज मरम्मत', 'उपकरण रिपेयर', 'वॉशिंग मशीन मरम्मत', 'फ्रिज ठीक करना', 'ड्रायर रिपेयर'],
  fr: ['réparation réfrigérateur', 'réparation lave-linge', 'réparation électroménager', 'dépannage réfrigérateur', 'réparation lave-vaisselle', 'réparation sèche-linge', 'réfrigérateur ne refroidit plus', 'réparateur électroménager', 'réparation four'],
};

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const lk = q.lang;
  if (!LANG[lk]) return json(400, { ok: false, error: 'lang required: es|vi|ru|ar|zh|hi|fr' });

  const c = await ga.creds();
  if (!c.clientId || !c.refresh || !c.devToken) return json(200, { ok: false, error: 'Google Ads not configured' });
  const cid = String((await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121').replace(/\D/g, '');
  let token; try { token = await ga.accessToken(c); } catch (e) { return json(200, { ok: false, error: 'token: ' + String(e.message || e) }); }

  const geos = (q.geo === 'local' ? GEO.local : GEO.us).map((g) => 'geoTargetConstants/' + g);
  const maxPages = Math.min(parseInt(q.pages || '4', 10) || 4, 8);
  const topN = Math.min(parseInt(q.top || '30', 10) || 30, 100);
  const url = `https://googleads.googleapis.com/${c.version}/customers/${cid}:generateKeywordIdeas`;
  const headers = ga.apiHeaders(token, c, cid); // Keyword Planner wants the account itself

  const all = []; let pageToken = null, pages = 0, apiErr = null;
  for (; pages < maxPages; pages++) {
    const body = {
      language: 'languageConstants/' + LANG[lk].id,
      geoTargetConstants: geos,
      keywordPlanNetwork: 'GOOGLE_SEARCH',
      includeAdultKeywords: false,
      pageSize: 1000,
      keywordSeed: { keywords: SEED[lk] },
    };
    if (pageToken) body.pageToken = pageToken;
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { apiErr = { status: r.status, error: (d.error && (d.error.message || d.error.status)) || d }; break; }
    for (const x of (d.results || [])) {
      const m = x.keywordIdeaMetrics || {};
      all.push({ kw: x.text, monthly: parseInt(m.avgMonthlySearches || 0, 10) || 0, competition: m.competition || 'UNSPECIFIED' });
    }
    pageToken = d.nextPageToken || null;
    if (!pageToken) { pages++; break; }
  }

  all.sort((a, b) => b.monthly - a.monthly);
  const totalMonthly = all.reduce((s, x) => s + x.monthly, 0);
  const withVolume = all.filter((x) => x.monthly > 0);
  return json(200, {
    ok: all.length > 0 || !apiErr,
    language: LANG[lk].name, geo: q.geo === 'local' ? 'TN+LA' : 'US', pages_pulled: pages,
    api_error: apiErr,
    ideas_returned: all.length, ideas_with_volume: withVolume.length,
    total_monthly_searches: totalMonthly,
    note: 'Full related-keyword universe from Google (seeds expanded). Sum = combined avg monthly searches of every in-language idea Google returned.',
    top_keywords: all.slice(0, topN),
  });
};
