// customer-index — a lean, compact dump of every customer for CLIENT-SIDE instant
// search. The browser fetches this once, caches it, and then searches locally with
// zero network per keystroke (no more 4,000-row cloud scan per search). Refresh is
// rare (a few times a day), so the ~5s build cost is paid once, not per search.
//
//   GET /.netlify/functions/customer-index
//   -> { ok, count, built_at, rows: [[id, first, last, phone10, city], ...] }
'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
function authHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

// Resolve the customer table id by field-shape (map conflicts across the repo).
let _cid = null;
async function customerTableId() {
  if (_cid) return _cid;
  for (const id of [5, 6, 1, 2, 8, 9, 10, 7, 14, 16]) {
    try {
      const r = await fetch(`${META}/table/${id}/content/search`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ per_page: 1, page: 1 }) });
      if (!r.ok) continue;
      const j = await r.json().catch(() => ({}));
      const row = (j.items || [])[0];
      if (row && row.first_name !== undefined && row.last_name !== undefined && row.phone !== undefined && row.conversation_id === undefined) { _cid = id; return id; }
    } catch (_) {}
  }
  throw new Error('could not resolve customer table id');
}

// Server-side warm cache so repeat calls within a container are instant.
let _rows = null, _at = 0;
const TTL = 30 * 60 * 1000;

async function buildIndex() {
  if (_rows && (Date.now() - _at) < TTL) return _rows;
  const cid = await customerTableId();
  const PER = 200, MAX_PAGES = 80, BATCH = 6;
  const rows = [];
  let stop = false;
  for (let base = 1; base <= MAX_PAGES && !stop; base += BATCH) {
    const pages = [];
    for (let p = base; p < base + BATCH && p <= MAX_PAGES; p++) pages.push(p);
    const got = await Promise.all(pages.map(async (p) => {
      const r = await fetch(`${META}/table/${cid}/content/search`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ sort: { id: 'desc' }, per_page: PER, page: p }) });
      if (!r.ok) return [];
      const j = await r.json().catch(() => ({}));
      return j.items || [];
    }));
    for (const list of got) {
      for (const c of list) {
        const phone = String(c.phone || '').replace(/[^0-9]/g, '').slice(-10);
        rows.push([c.id, (c.first_name || '').trim(), (c.last_name || '').trim(), phone, (c.city || '').trim()]);
      }
      if (list.length < PER) stop = true;
    }
  }
  _rows = rows; _at = Date.now();
  return rows;
}

exports.handler = async function () {
  try {
    const rows = await buildIndex();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
      body: JSON.stringify({ ok: true, count: rows.length, built_at: Date.now(), rows }),
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
