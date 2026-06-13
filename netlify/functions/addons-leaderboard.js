// Add-on earnings per tech for the leaderboard — so the guys can see who's
// stacking extra money on add-on work. Buckets fulfilled add-ons by tech for a
// calendar month (CT), matching the leaderboard's month_offset (0=this month).
// De-dupes per job+addon so a re-fulfill doesn't double-count.
//
// GET /.netlify/functions/addons-leaderboard?month_offset=0
// -> { success, by_tech: { "<tech_id>": { cut, count } } }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
async function fetchByAction(action) {
  const out = [];
  for (let page = 1; page <= 6; page++) {
    const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ search: { action }, sort: { created_at: 'desc' }, per_page: 500, page }),
    });
    if (!r.ok) break;
    const d = await r.json();
    const items = (d && d.items) || [];
    out.push(...items);
    if (items.length < 500) break;
  }
  return out;
}
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }

// CT-anchored [start,end) ms for a month offset (0 = current month).
function monthWindow(offset) {
  const now = new Date();
  const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const y = ct.getFullYear(), m = ct.getMonth() + offset;
  const start = new Date(y, m, 1).getTime();
  const end = new Date(y, m + 1, 1).getTime();
  return { start, end };
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  const offset = parseInt((event.queryStringParameters || {}).month_offset, 10) || 0;
  const { start, end } = monthWindow(offset);
  try {
    const addons = await fetchByAction('addon_fulfilled');
    const seen = new Set();
    const by_tech = {};
    for (const row of addons) {
      const m = meta(row);
      const tid = parseInt(m.technician_id, 10);
      const cut = num(m.tech_cut);
      if (!tid || !cut) continue;
      const when = num(m.requested_at_ms) || (row.created_at ? Date.parse(row.created_at) : 0);
      if (when < start || when >= end) continue;
      const key = m.job_id + '|' + m.addon_key;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!by_tech[tid]) by_tech[tid] = { cut: 0, count: 0 };
      by_tech[tid].cut += cut;
      by_tech[tid].count += 1;
    }
    for (const k in by_tech) by_tech[k].cut = Number(by_tech[k].cut.toFixed(2));
    return { statusCode: 200, body: JSON.stringify({ success: true, by_tech }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ success: false, error: err.message, by_tech: {} }) };
  }
};
