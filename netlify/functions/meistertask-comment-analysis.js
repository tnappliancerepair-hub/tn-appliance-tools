// meistertask-comment-analysis — mines the pulled COMMENT threads (board='_comment'
// rows in meistertask_archive) for the money picture Teddy asked for:
//   • labor rate history ($/hr) by year
//   • diagnosis fee ("$95.00") frequency
//   • labor hours distribution (from "LABOR HOURS\n1.5" TDR blocks)
//   • repair-estimate totals by appliance
//   • parts sourcing mix (Marcone / Tribles / VNV / Encompass …)
//   • payments collected ("75 PAID") + cash-out/buyout offers
//   • part numbers seen (top, for the parts price-book seed)
// Reads in pages, aggregates, returns. Scope by ?board= (defaults to all _comment rows).
//   GET ?secret=<admin>[&board=TN%20Jobs]
'use strict';

const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TABLE = 'meistertask_archive';
const PAGE = 500;

function money(re, text, out) { let m; const rx = new RegExp(re.source, 'gi'); while ((m = rx.exec(text)) !== null) { const v = parseFloat(String(m[1] || '').replace(/,/g, '')); if (!isNaN(v)) out.push(v); } }
function stats(arr) { if (!arr.length) return { n: 0 }; const s = arr.slice().sort((a, b) => a - b); const sum = s.reduce((a, b) => a + b, 0); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, min: s[0], max: s[s.length - 1], avg: Math.round((sum / s.length) * 100) / 100, median: q(0.5), p25: q(0.25), p75: q(0.75) }; }
function bump(o, k) { o[k] = (o[k] || 0) + 1; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };
  if (!(await sb.isConnected())) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'supabase_not_configured' }) };

  const scopeBoard = q.board || '';
  const res = {
    scope: scopeBoard || 'ALL _comment rows', comment_cards: 0, total_comments: 0,
    labor_rate_per_hr: [], labor_rate_by_year: {}, diagnosis_fee_95: 0,
    labor_hours: [], repair_estimate_totals: [], paid_amounts: [], cashout_offers: [],
    parts_source: {}, part_numbers: {}, cards_with_diagnosis_block: 0, cards_with_payment: 0,
  };
  const partRe = /\b([A-Z]{1,4}\d{2,}[A-Z0-9]{2,})\b/g; // loose appliance part-number shape (WP2198202, DC92-01802Q-ish)
  let offset = 0;
  for (;;) {
    let rows;
    try { rows = await sb.select(TABLE, { board: 'eq._comment', select: 'card,card_id', order: 'id.asc', limit: String(PAGE), offset: String(offset) }); }
    catch (e) { res.error = String((e && e.message) || e); break; }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) {
      const card = r.card || {};
      if (scopeBoard && card.board !== scopeBoard) continue;
      const comments = Array.isArray(card.comments) ? card.comments : [];
      if (!comments.length) continue;
      res.comment_cards++;
      res.total_comments += comments.length;
      let hasDiag = false, hasPay = false;
      for (const cm of comments) {
        const text = String((cm && (cm.text || cm.body || cm.content)) || '');
        const yr = String((cm && cm.created_at) || (cm && cm.at) || '').slice(0, 4);
        if (!text) continue;
        // labor rate $/hr (e.g. "1 x $75.00/hr", "$80.00/hr", "2 x $80.00/hr")
        const rates = [];
        money(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*\/\s*hr/, text, rates);
        for (const v of rates) { res.labor_rate_per_hr.push(v); if (/^\d{4}$/.test(yr)) { (res.labor_rate_by_year[yr] = res.labor_rate_by_year[yr] || []).push(v); } }
        // diagnosis fee $95
        if (/\$\s*95(?:\.0{1,2})?\b/.test(text)) res.diagnosis_fee_95++;
        // labor hours from TDR block
        const lh = []; money(/labor\s*hours[^\d]{0,8}([\d.]+)/i, text, lh); money(/\btime\s*[:=]?\s*([\d.]+)\b/i, text, lh);
        for (const v of lh) if (v > 0 && v <= 12) res.labor_hours.push(v);
        // repair estimate totals (the big "Diagnosis & Repair Estimate ... $187.50" / "$315.00")
        const est = []; money(/repair estimate[^$]{0,40}\$\s*([\d,]+(?:\.\d{2})?)/i, text, est);
        for (const v of est) res.repair_estimate_totals.push(v);
        // payments collected ("75 PAID", "PAID 75", "$75 paid")
        if (/\bpaid\b/i.test(text)) { const p = []; money(/(?:\$?\s*([\d,]+(?:\.\d{2})?)\s*paid|paid[^\d]{0,8}\$?\s*([\d,]+(?:\.\d{2})?))/i, text, p); for (const v of p) if (v >= 10 && v <= 5000) res.paid_amounts.push(v); hasPay = true; }
        // cash-out / buyout offers
        if (/cash ?out|buyout|buy ?out|\bLTD\b|cash in lieu|\bCIL\b/i.test(text)) { const c = []; money(/(?:cash ?out|buyout|buy ?out|offer)[^$]{0,30}\$\s*([\d,]+(?:\.\d{2})?)/i, text, c); for (const v of c) res.cashout_offers.push(v); }
        // parts sourcing
        for (const [name, re] of [['Marcone', /marcone/i], ['Tribles', /tribles?/i], ['VNV', /\bvnv\b/i], ['Encompass', /encompass/i], ['Reliable', /reliable/i], ['AHS parts', /ahs parts|warranty (?:issued|sent|shipped|parts)/i], ['Amazon', /amazon/i]]) if (re.test(text)) bump(res.parts_source, name);
        // diagnosis block + part numbers
        if (/diagnosis|parts that failed|cause of failure/i.test(text)) hasDiag = true;
        let pm; const prx = new RegExp(partRe.source, 'g');
        while ((pm = prx.exec(text)) !== null) { const pn = pm[1]; if (pn.length >= 5 && pn.length <= 16 && /[A-Z]/.test(pn) && /\d/.test(pn)) bump(res.part_numbers, pn); }
      }
      if (hasDiag) res.cards_with_diagnosis_block++;
      if (hasPay) res.cards_with_payment++;
    }
    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  // collapse to stats + top-N
  const byYear = {}; for (const y of Object.keys(res.labor_rate_by_year).sort()) byYear[y] = stats(res.labor_rate_by_year[y]);
  const topParts = Object.entries(res.part_numbers).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([p, n]) => ({ part: p, seen: n }));
  const out = {
    ok: true, scope: res.scope, comment_cards: res.comment_cards, total_comments: res.total_comments,
    cards_with_diagnosis_block: res.cards_with_diagnosis_block, cards_with_payment: res.cards_with_payment,
    labor_rate_per_hr: stats(res.labor_rate_per_hr), labor_rate_by_year: byYear,
    diagnosis_fee_95_mentions: res.diagnosis_fee_95,
    labor_hours: stats(res.labor_hours), repair_estimate_totals: stats(res.repair_estimate_totals),
    paid_amounts: stats(res.paid_amounts), cashout_offers: stats(res.cashout_offers),
    parts_source: res.parts_source, top_part_numbers: topParts,
    error: res.error,
  };
  try { await sb.insert(TABLE, { board: '_comment_analysis', card_id: scopeBoard || 'ALL', title: 'comment_analysis', notes: '', card: out }); } catch (_) {}
  return { statusCode: 200, body: JSON.stringify(out, null, 2) };
};
