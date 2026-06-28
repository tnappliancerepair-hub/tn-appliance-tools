// meistertask-repair-price — focused price probe for ONE repair type. Scans the
// comment archive for cards whose threads mention the keyword (e.g. "ice maker"),
// pulls every dollar amount, labor hours, paid amounts, and part numbers, and
// returns stats + the actual $ snippets so we can see what was really charged.
//   GET ?secret=<admin>&match=ice%20maker
'use strict';

const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TABLE = 'meistertask_archive';
const PAGE = 500;

function nums(re, text, out) { let m; const rx = new RegExp(re.source, 'gi'); while ((m = rx.exec(text)) !== null) { const v = parseFloat(String(m[1] || '').replace(/,/g, '')); if (!isNaN(v)) out.push(v); } }
function stats(arr) { if (!arr.length) return { n: 0 }; const s = arr.slice().sort((a, b) => a - b); const sum = s.reduce((a, b) => a + b, 0); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, min: s[0], max: s[s.length - 1], avg: Math.round(sum / s.length * 100) / 100, median: q(0.5), p25: q(0.25), p75: q(0.75) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };
  if (!(await sb.isConnected())) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'supabase_not_configured' }) };
  const match = String(q.match || 'ice maker');
  const re = new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, ' ?'), 'i');

  const seen = new Set();
  const all_dollars = [], labor_hours = [], paid = [], dollar_snippets = [], parts = {};
  let matchedCards = 0, offset = 0;
  for (;;) {
    let rows;
    try { rows = await sb.select(TABLE, { board: 'eq._comment', select: 'card,card_id', order: 'id.asc', limit: String(PAGE), offset: String(offset) }); }
    catch (e) { return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) }; }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) {
      const card = r.card || {};
      const cid = String(card.card_id || r.card_id || '');
      if (cid && seen.has(cid)) continue; if (cid) seen.add(cid);
      const list = Array.isArray(card.comments) ? card.comments : [];
      const joined = list.map((c) => String((c && (c.text || c.body || c.content)) || '')).join('\n');
      if (!re.test(joined)) continue;
      matchedCards++;
      // all dollar amounts $XX or $XX.XX
      nums(/\$\s*([\d,]+(?:\.\d{2})?)/, joined, all_dollars);
      // labor hours
      const lh = []; nums(/labor\s*hours[^\d]{0,8}([\d.]+)/i, joined, lh); nums(/\btime\s*[:=]?\s*([\d.]+)\b/i, joined, lh);
      for (const v of lh) if (v > 0 && v <= 12) labor_hours.push(v);
      // paid amounts
      nums(/(?:\$?\s*([\d,]+(?:\.\d{2})?)\s*paid|paid[^\d]{0,8}\$?\s*([\d,]+(?:\.\d{2})?))/i, joined, paid);
      // part numbers near "ice maker"
      let pm; const prx = /\b([A-Z]{1,4}\d{2,}[A-Z0-9]{2,})\b/g;
      while ((pm = prx.exec(joined)) !== null) { const pn = pm[1]; if (pn.length >= 5 && pn.length <= 16 && /[A-Z]/.test(pn) && /\d/.test(pn) && !/^NSA|^SCC|^SO\d|^SJ\d/i.test(pn)) parts[pn] = (parts[pn] || 0) + 1; }
      // keep snippets that actually contain a $ (to eyeball real charges)
      if (dollar_snippets.length < 25 && /\$\s?\d/.test(joined)) {
        const i = Math.max(0, joined.search(/\$\s?\d/) - 40);
        dollar_snippets.push(joined.slice(i, i + 180).replace(/\s+/g, ' ').trim());
      }
    }
    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  const topParts = Object.entries(parts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => ({ part: p, seen: n }));
  return { statusCode: 200, body: JSON.stringify({
    ok: true, match, matched_cards: matchedCards,
    all_dollar_amounts: stats(all_dollars), labor_hours: stats(labor_hours),
    paid_amounts: stats(paid.filter((v) => v >= 10 && v <= 5000)),
    top_parts: topParts, dollar_snippets,
  }, null, 2) };
};
