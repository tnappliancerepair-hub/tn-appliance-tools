// hcp-recall — pull real history for a machine out of the 24k-job HCP archive so
// Ant Brain's pre-diagnosis isn't thin (Teddy 7/5, "pour the archives in"). The
// archive's invoices carry no part numbers (just fees), but the job text does
// carry the machine + the complaint + what we did — so recall grounds the
// pre-diagnosis in "we've seen this exact model N times, here's what came up."
//
// Text search over hcp_vectors.body (the cleaned job text, plain column — no
// pgvector RPC needed). Model match first (highest signal), then brand+appliance.
//
//   GET ?model=WTW5000DW1[&brand=Whirlpool&appliance=washer&limit=6]
//     -> { ok, matched_on, seen_n, jobs:[{hcp_id, snippet}] }
'use strict';
const sb = require('./_lib/supabase');
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'cache-control': 'no-store' }, body: JSON.stringify(b) }; }
function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

async function ilike(term, limit) {
  const t = clean(term);
  if (t.length < 3) return [];
  try { return (await sb.select('hcp_vectors', { body: 'ilike.*' + t + '*', select: 'hcp_id,body', limit })) || []; }
  catch (_) { return []; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  const q = event.queryStringParameters || {};
  const model = clean(q.model), brand = clean(q.brand), appliance = clean(q.appliance);
  const limit = Math.max(1, Math.min(12, parseInt(q.limit, 10) || 6));
  if (!(await sb.isConnected())) return j(200, { ok: false, error: 'archive not configured' });

  let rows = [], matched = null;
  // 1) exact model — the strongest signal (same machine)
  if (model && model.length >= 4) { rows = await ilike(model, limit); if (rows.length) matched = 'model'; }
  // 2) brand + appliance — broaden to the family
  if (!rows.length && (brand || appliance)) {
    const base = brand ? await ilike(brand, 40) : [];
    const term = appliance ? appliance.toLowerCase().split(/\s+/)[0] : '';
    rows = (term ? base.filter((r) => String(r.body || '').toLowerCase().includes(term)) : base).slice(0, limit);
    if (rows.length) matched = brand && appliance ? 'brand+appliance' : (brand ? 'brand' : 'appliance');
    if (!rows.length && appliance) { rows = (await ilike(term || appliance, limit)); if (rows.length) matched = 'appliance'; }
  }

  const jobs = rows.map((r) => ({ hcp_id: r.hcp_id, snippet: clean(r.body).slice(0, 220) }));
  return j(200, { ok: true, matched_on: matched, seen_n: jobs.length, model: model || null, jobs });
};
