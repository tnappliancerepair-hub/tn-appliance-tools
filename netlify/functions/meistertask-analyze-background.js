// meistertask-analyze-background — reads the archived MeisterTask cards out of
// Supabase and computes the patterns Teddy asked for off 7 years of history:
//   • per-board counts + date range (earliest/latest card)
//   • appliance mix (washer/dryer/fridge/range/dishwasher/…)
//   • warranty-vendor mix (AHS/Frontdoor, NSA, SquareTrade, ServiceBench/CCHS, ServicePower, ARW…)
//   • dollar patterns pulled from the notes: Parts Pre-Auth, Deductible, LOLA balance, any labor $
// Writes the result as a board='_analysis' row in meistertask_archive so a tiny
// sync reader can return it without re-crunching. No timeout risk (background = 15 min).
//   GET ?secret=<admin>[&board=TN%20Jobs]
'use strict';

const { getSecret } = require('./_lib/secrets');
const sb = require('./_lib/supabase');

const LEGACY_ADMIN = 'tn-vapi-admin-9f83b1c4e7a206d5';
const TABLE = 'meistertask_archive';
const PAGE = 1000;

const APPLIANCES = [
  ['dishwasher', /\bdish ?washer\b/i],
  ['dryer', /\bdryer\b/i],
  ['washer', /\b(washer|washing machine)\b/i],
  ['refrigerator', /\b(refrigerator|fridge|freezer|ice ?maker|icemaker)\b/i],
  ['range/oven', /\b(range|oven|cooktop|stove|wall oven)\b/i],
  ['microwave', /\bmicrowave\b/i],
  ['disposal', /\b(garbage )?disposal\b/i],
];
const VENDORS = [
  ['AHS / Frontdoor', /\b(american home shield|frontdoor|ahs|shieldgold|shieldplatinum|shieldsilver)\b/i],
  ['ServiceBench / Cross Country', /\b(servicebench|cross country|cchs)\b/i],
  ['NSA / Ironwood', /\b(national service alliance|\bnsa\b|ironwood)\b/i],
  ['SquareTrade / Allstate', /\b(squaretrade|square trade|allstate)\b/i],
  ['ServicePower', /\bservicepower\b/i],
  ['ARW / Choice', /\b(\barw\b|choice home warranty|choicehomewarranty)\b/i],
  ['Cinch / Cross', /\bcinch\b/i],
  ['2-10', /\b2-10\b/i],
  ['Old Republic', /\bold republic\b/i],
];

function moneyList(re, text) {
  const out = [];
  let m;
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = rx.exec(text)) !== null) {
    const v = parseFloat(String(m[1] || '').replace(/,/g, ''));
    if (!isNaN(v)) out.push(v);
  }
  return out;
}
function stats(arr) {
  if (!arr.length) return { n: 0 };
  const s = arr.slice().sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], max: s[s.length - 1], avg: Math.round((sum / s.length) * 100) / 100, median: q(0.5), p25: q(0.25), p75: q(0.75) };
}

async function analyze({ board } = {}) {
  const result = {
    started_at: new Date().toISOString(),
    scope: board || 'ALL',
    total_cards: 0,
    by_board: {},
    appliance_mix: {},
    vendor_mix: {},
    date_min: null, date_max: null,
    parts_preauth: [], deductible: [], lola: [], labor_dollars: [],
    cards_with_any_dollar: 0,
  };
  let offset = 0;
  for (;;) {
    const params = { select: 'board,title,notes,created:card->>created_at', order: 'id.asc', limit: String(PAGE), offset: String(offset) };
    if (board) params.board = 'eq.' + board;
    else params.board = 'neq._manifest';
    let rows;
    try { rows = await sb.select(TABLE, params); } catch (e) { result.error = String((e && e.message) || e); break; }
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) {
      if (r.board === '_manifest' || r.board === '_analysis') continue;
      result.total_cards++;
      result.by_board[r.board] = (result.by_board[r.board] || 0) + 1;
      const text = ((r.title || '') + '\n' + (r.notes || ''));
      // date range
      const c = r.created;
      if (c) { if (!result.date_min || c < result.date_min) result.date_min = c; if (!result.date_max || c > result.date_max) result.date_max = c; }
      // appliance (first match wins, dishwasher before washer so "dishwasher" isn't counted as washer)
      for (const [name, re] of APPLIANCES) { if (re.test(text)) { result.appliance_mix[name] = (result.appliance_mix[name] || 0) + 1; break; } }
      // vendors (a card can match more than one — count each)
      for (const [name, re] of VENDORS) { if (re.test(text)) result.vendor_mix[name] = (result.vendor_mix[name] || 0) + 1; }
      // dollars
      const pa = moneyList(/parts?\s*pre\s*-?\s*auth[^$\d]*\$?\s*([\d,]+(?:\.\d{1,2})?)/i, text);
      const ded = moneyList(/deductible[^$\d]{0,12}\$?\s*([\d,]+(?:\.\d{1,2})?)/i, text);
      const lola = moneyList(/(?:lola|lola balance|remaining lola)[^$\d]{0,12}\$?\s*([\d,]+(?:\.\d{1,2})?)/i, text);
      const lab = moneyList(/labor[^$]{0,40}\$\s*([\d,]+(?:\.\d{1,2})?)/i, text);
      result.parts_preauth.push(...pa);
      result.deductible.push(...ded);
      result.lola.push(...lola);
      result.labor_dollars.push(...lab);
      if (/\$\s?\d/.test(text)) result.cards_with_any_dollar++;
    }
    offset += rows.length;
    if (rows.length < PAGE) break;
  }
  // collapse the raw arrays to stats to keep the stored row small
  const out = {
    ...result,
    parts_preauth: stats(result.parts_preauth),
    deductible: stats(result.deductible),
    lola: stats(result.lola),
    labor_dollars: stats(result.labor_dollars),
    finished_at: new Date().toISOString(),
  };
  return out;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let admin = ''; try { admin = (await getSecret('VAPI_ADMIN_SECRET')) || ''; } catch (_) {}
  admin = admin || LEGACY_ADMIN;
  if (q.secret !== admin) return { statusCode: 401, body: 'unauthorized' };
  if (!(await sb.isConnected())) return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'supabase_not_configured' }) };
  try {
    const res = await analyze({ board: q.board || '' });
    try { await sb.insert(TABLE, { board: '_analysis', card_id: q.board || 'ALL', title: 'meistertask_analysis', notes: '', card: res }); } catch (_) {}
    return { statusCode: 200, body: JSON.stringify({ ok: true, analysis: res }, null, 2) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
