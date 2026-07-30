// gsc-languages — is the multilingual SEO push getting impressions yet, and what's
// working? Pulls page-level Search Console data and buckets every URL by its
// language folder (/es/ /ru/ /vi/ /ar/ /zh/ /hi/ /fr/), vs English (everything else).
//   GET ?secret=<admin>[&days=28]
'use strict';
const sc = require('./_lib/search-console');
const { getSecret } = require('./_lib/secrets');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

const LANGS = [
  { code: 'es', label: 'Spanish', re: /\/es\// },
  { code: 'ru', label: 'Russian', re: /\/ru\// },
  { code: 'vi', label: 'Vietnamese', re: /\/vi\// },
  { code: 'ar', label: 'Arabic', re: /\/ar\// },
  { code: 'zh', label: 'Chinese', re: /\/zh\// },
  { code: 'hi', label: 'Hindi', re: /\/hi\// },
  { code: 'fr', label: 'French', re: /\/fr\// },
];

exports.config = { timeout: 26 };
exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const days = parseInt(q.days, 10) || 28;

  try {
    const res = await sc.query({ days, dimensions: ['page'], rowLimit: 5000 });
    if (!res.ok) return json(200, res);
    const rows = res.rows || [];

    const b = {}; const tops = {};
    for (const L of LANGS) { b[L.code] = { label: L.label, impressions: 0, clicks: 0, pages: 0 }; tops[L.code] = []; }
    let en = { impressions: 0, clicks: 0, pages: 0 };

    for (const r of rows) {
      const page = (r.keys && r.keys[0]) || '';
      const impr = r.impressions || 0, clicks = r.clicks || 0;
      const L = LANGS.find((x) => x.re.test(page));
      if (L) {
        b[L.code].impressions += impr; b[L.code].clicks += clicks; b[L.code].pages++;
        tops[L.code].push({ page: page.replace('https://tnapplianceexchange.net', ''), impr, clicks, pos: r.position });
      } else { en.impressions += impr; en.clicks += clicks; en.pages++; }
    }

    const languages = LANGS.map((L) => ({
      code: L.code, label: L.label,
      impressions: b[L.code].impressions, clicks: b[L.code].clicks, pages_ranking: b[L.code].pages,
      top: tops[L.code].sort((a, b2) => b2.impr - a.impr).slice(0, 6),
    })).sort((a, b2) => b2.impressions - a.impressions);

    const totalNonEng = languages.reduce((s, l) => s + l.impressions, 0);
    return json(200, {
      ok: true, days,
      summary: { non_english_impressions: totalNonEng, non_english_clicks: languages.reduce((s, l) => s + l.clicks, 0), languages_with_impressions: languages.filter((l) => l.impressions > 0).length },
      english: en, languages,
    });
  } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
};
