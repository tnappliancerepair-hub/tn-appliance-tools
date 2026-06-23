// cpsc-recalls — official U.S. appliance recalls from the CPSC SaferProducts API
// (free, no auth, authoritative). Always-on (no daemon), so recalls show even when
// the MSA daemon is offline. Internal/tech reference.
//
//   POST { brand, appliance?, model? }  (or GET ?brand=&appliance=&model=)
//   → { ok, count, recalls: [{ title, date, url, hazard, remedy, manufacturers,
//                              products, models, matched_model }] }
'use strict';

const CPSC = 'https://www.saferproducts.gov/RestWebServices/Recall';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'content-type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b) }; }

// Map a loose appliance type to keywords we expect in the recall's product text,
// so a "dishwasher" search doesn't pull a brand's unrelated recalls.
function applWords(a) {
  const s = String(a || '').toLowerCase();
  if (/fridge|refriger|freezer/.test(s)) return ['refrigerator', 'fridge', 'freezer'];
  if (/dishwash/.test(s)) return ['dishwasher'];
  if (/dryer/.test(s)) return ['dryer'];
  if (/wash/.test(s)) return ['washer', 'washing machine', 'laundry'];
  if (/oven|range|stove|cooktop|cook top/.test(s)) return ['oven', 'range', 'stove', 'cooktop'];
  if (/microwave/.test(s)) return ['microwave'];
  if (/disposal/.test(s)) return ['disposal', 'disposer'];
  if (/ice/.test(s)) return ['ice maker', 'icemaker'];
  return []; // unknown/blank → no appliance filter
}

async function run(b) {
  const brand = String(b.brand || '').trim();
  const appliance = String(b.appliance || b.appliance_type || '').trim();
  const model = String(b.model || '').trim();

  const params = new URLSearchParams();
  params.set('format', 'json');
  if (brand) params.set('Manufacturer', brand);
  else if (appliance) params.set('ProductName', appliance);
  else return { ok: false, error: 'brand or appliance required', recalls: [] };

  const r = await fetch(`${CPSC}?${params.toString()}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(16000) });
  if (!r.ok) return { ok: false, error: 'cpsc ' + r.status, recalls: [] };
  const data = await r.json().catch(() => []);
  const arr = Array.isArray(data) ? data : [];

  const words = applWords(appliance);
  const modelLc = model.toLowerCase();
  const out = [];
  for (const rec of arr) {
    const products = rec.Products || [];
    const prodText = products.map((p) => `${p.Name || ''} ${p.Description || ''} ${p.Type || ''}`).join(' ').toLowerCase();
    if (words.length && !words.some((w) => prodText.includes(w))) continue; // appliance filter
    const models = products.map((p) => String(p.Model || '').trim()).filter(Boolean);
    const matched_model = !!(modelLc && models.some((m) => { const ml = m.toLowerCase(); return ml.includes(modelLc) || modelLc.includes(ml); }));
    out.push({
      title: rec.Title, date: String(rec.RecallDate || '').slice(0, 10), url: rec.URL,
      hazard: (rec.Hazards || []).map((h) => h.Name).filter(Boolean).join('; '),
      remedy: (rec.Remedies || []).map((x) => x.Name).filter(Boolean).join('; '),
      manufacturers: (rec.Manufacturers || []).map((m) => m.Name).filter(Boolean),
      products: products.map((p) => p.Name).filter(Boolean).slice(0, 4),
      models: models.slice(0, 10), matched_model,
    });
  }
  out.sort((a, c) => (c.matched_model ? 1 : 0) - (a.matched_model ? 1 : 0) || String(c.date).localeCompare(String(a.date)));
  return { ok: true, count: out.length, recalls: out.slice(0, 15) };
}

exports.config = { timeout: 20 };

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  let b = {};
  if (event.httpMethod === 'POST') { try { b = JSON.parse(event.body || '{}'); } catch (_) {} }
  else b = event.queryStringParameters || {};
  try { return json(200, await run(b)); }
  catch (e) { return json(200, { ok: false, error: String((e && e.message) || e), recalls: [] }); }
};
