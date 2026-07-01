// search-customers — forgiving customer search via the Xano Metadata API.
//
// WHY: the XanoScript search_customers endpoint is brittle (exact-match only,
// times out on common names, and a |contains: attempt ParseError'd). This runs
// the search in a place we can actually TEST (curl this function), handles
// case + middle names + multi-token, and CANNOT throw a Xano ParseError because
// every query is a simple single-field exact match (the proven metadata shape).
//
//   GET  /.netlify/functions/search-customers?q=Brumfield
//   POST /.netlify/functions/search-customers   {"query":"Victor Brumfield"}
//   GET  ...?probe=1   -> which table ids resolved (customer/jobs), no search
//
// Returns the SAME shape customer-search.html + the vapi proxy expect:
//   { success, query, match_count, results:[{customer, latest_job, job_count}] }

'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');

function authHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

// Single-field exact search on a table (the only metadata shape that works
// reliably — multi-field is silently ignored, per metadata-crud notes).
async function searchField(tableId, field, value, perPage, sort) {
  const body = { search: { [field]: value }, per_page: perPage || 15, page: 1 };
  if (sort) body.sort = sort;
  const r = await fetch(`${META}/table/${tableId}/content/search`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
  });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j && j.items) || [];
}

// Probe the customer + jobs table ids (maps conflict across the repo: reset-run
// says customer=5, metadata-crud says agent_message=5). Identify by FIELD shape:
// a customer row has first_name+last_name+phone; a jobs row has customer_id+
// scheduling_status. Cached per warm container.
let _ids = null;
async function resolveIds() {
  if (_ids) return _ids;
  const candidates = [5, 6, 1, 2, 8, 9, 10, 7, 14, 16];
  let customer = null, jobs = null;
  for (const id of candidates) {
    if (customer && jobs) break;
    let row;
    try {
      const r = await fetch(`${META}/table/${id}/content/search`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ per_page: 1, page: 1 }),
      });
      if (!r.ok) continue;
      const j = await r.json().catch(() => ({}));
      row = (j.items || [])[0];
    } catch (_) { continue; }
    if (!row) continue;
    const keys = Object.keys(row);
    const hasName = keys.includes('first_name') && keys.includes('last_name');
    const hasPhone = keys.includes('phone');
    const looksCustomer = hasName && hasPhone && !keys.includes('conversation_id');
    const looksJobs = keys.includes('customer_id') && (keys.includes('scheduling_status') || keys.includes('job_number'));
    if (!customer && looksCustomer) customer = id;
    if (!jobs && looksJobs) jobs = id;
  }
  _ids = { customer, jobs };
  return _ids;
}

function uniqByIdPush(map, rows) { for (const r of rows) if (r && r.id != null && !map.has(r.id)) map.set(r.id, r); }

// Bounded Levenshtein — for fuzzy name matching against voice mis-transcriptions
// ("Minge" heard as "Menge", "Cailin" as "Kaylin"). Caps at maxD for speed.
function lev(a, b, maxD) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxD) return maxD + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxD) return maxD + 1;
    prev = cur;
  }
  return prev[b.length];
}

function nameVariants(tok) {
  const lower = tok.toLowerCase();
  const title = lower.charAt(0).toUpperCase() + lower.slice(1);
  const upper = lower.toUpperCase();
  return [...new Set([title, upper, lower, tok])];
}

// Substring search needs candidates in memory — the Metadata API has no working
// contains operator (verified: $contains 400s, array-operator returns
// UNFILTERED). Pull the most-recent ~4000 customers once per warm container
// (covers the whole cutover-era population; older still found by exact match).
let _cust = null, _custAt = 0;
const CUST_TTL_MS = 10 * 60 * 1000;
async function recentCustomers(tableId) {
  if (_cust && (Date.now() - _custAt) < CUST_TTL_MS) return _cust;
  const PER = 200, MAX_PAGES = 20, BATCH = 5;
  const all = [];
  let stop = false;
  for (let base = 1; base <= MAX_PAGES && !stop; base += BATCH) {
    const pages = [];
    for (let p = base; p < base + BATCH && p <= MAX_PAGES; p++) pages.push(p);
    const batches = await Promise.all(pages.map(async (p) => {
      const r = await fetch(`${META}/table/${tableId}/content/search`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ sort: { id: 'desc' }, per_page: PER, page: p }),
      });
      if (!r.ok) return [];
      const j = await r.json().catch(() => ({}));
      return (j.items || []);
    }));
    for (const rows of batches) { all.push(...rows); if (rows.length < PER) stop = true; }
  }
  _cust = all; _custAt = Date.now();
  return all;
}

async function run(query) {
  const ids = await resolveIds();
  if (!ids.customer) return { success: false, error: 'could not resolve customer table id', resolved: ids };

  const q = String(query || '').trim();
  if (!q) return { success: false, error: 'query required' };
  const digits = q.replace(/[^0-9]/g, '');
  const map = new Map();

  // Phone branch (exact, indexed, fast)
  if (digits.length >= 7) {
    const last10 = digits.slice(-10);
    const phoneForms = [...new Set([digits, last10, '+1' + last10])];
    const results = await Promise.all(phoneForms.map((p) => searchField(ids.customer, 'phone', p, 15)));
    results.forEach((rows) => uniqByIdPush(map, rows));
  }

  // Name branch
  if (digits.length < q.length) {
    // 1) Exact fast-path (catches ALL customers incl. old, precise last name).
    const tokens = q.split(/\s+/).filter((t) => t.length >= 2).slice(0, 4);
    const exactJobs = [];
    for (const tok of tokens) {
      for (const v of nameVariants(tok)) {
        exactJobs.push(searchField(ids.customer, 'last_name', v, 15));
        exactJobs.push(searchField(ids.customer, 'first_name', v, 15));
      }
    }
    // 2) Substring pass over recent customers (partials, suffixes "Young III",
    //    middle names). Match if EVERY token appears in "first last" (any case).
    const [exactResults, pool] = await Promise.all([
      Promise.all(exactJobs),
      recentCustomers(ids.customer),
    ]);
    exactResults.forEach((rows) => uniqByIdPush(map, rows));
    // Scored fuzzy pass — robust to voice mis-hears and one-name-right cases.
    // Each query token scores its BEST match against the customer's first/last
    // name AND city words: exact=3, substring=2, fuzzy(edit-distance)=1. Keep a
    // customer if it has a strong hit OR two soft hits, then rank by score. This
    // fixes the "couldn't find them by name" misses (e.g. Phil Minge / Nolensville).
    const toks = tokens.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);
    if (toks.length) {
      const scored = [];
      for (const c of pool) {
        const words = ((c.first_name || '') + ' ' + (c.last_name || '') + ' ' + (c.city || ''))
          .toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
        let score = 0, strong = 0;
        for (const t of toks) {
          let best = 0;
          for (const w of words) {
            if (w === t) best = Math.max(best, 3);
            else if (w.includes(t) || t.includes(w)) best = Math.max(best, 2);
            else if (lev(w, t, t.length >= 5 ? 2 : 1) <= (t.length >= 5 ? 2 : 1)) best = Math.max(best, 1);
            if (best === 3) break;
          }
          score += best;
          if (best >= 2) strong++;
        }
        if (strong >= 1 || score >= 2) scored.push({ c, score });
      }
      scored.sort((a, b) => b.score - a.score || (Number(b.c.id) - Number(a.c.id)));
      for (const s of scored.slice(0, 20)) uniqByIdPush(map, [s.c]);
    }
  }

  // Decorate (bounded): latest job + count for up to 12 matches.
  const customers = [...map.values()].slice(0, 25);
  const top = customers.slice(0, 12);
  const decorated = await Promise.all(top.map(async (c) => {
    let latest_job = null, job_count = 0;
    if (ids.jobs) {
      const recent = await searchField(ids.jobs, 'customer_id', c.id, 25, { created_at: 'desc' });
      job_count = recent.length;
      latest_job = recent[0] || null;
    }
    return { customer: c, latest_job, job_count };
  }));
  // Remaining matches without decoration (cheap)
  for (const c of customers.slice(12)) decorated.push({ customer: c, latest_job: null, job_count: 0 });

  return { success: true, query: q, match_count: decorated.length, results: decorated };
}

exports.handler = async function (event) {
  const qp = event.queryStringParameters || {};
  try {
    if (qp.probe === '1') {
      const ids = await resolveIds();
      return { statusCode: 200, body: JSON.stringify({ ok: true, resolved: ids }) };
    }
    // Probe which metadata search shapes support substring/contains. ?debug=Brum
    if (qp.debug) {
      const ids = await resolveIds();
      const term = qp.debug;
      const shapes = {
        exact: { search: { last_name: term }, per_page: 5 },
        op_contains: { search: { last_name: { '$contains': term } }, per_page: 5 },
        arr_contains: { search: [{ field: 'last_name', operator: 'contains', value: term }], per_page: 5 },
        arr_includes: { search: [{ field: 'last_name', operator: 'includes', value: term }], per_page: 5 },
      };
      const out = {};
      for (const [k, body] of Object.entries(shapes)) {
        try {
          const r = await fetch(`${META}/table/${ids.customer}/content/search`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
          const j = await r.json().catch(() => ({}));
          out[k] = { status: r.status, count: (j.items || []).length, sample: (j.items || []).slice(0, 2).map((c) => c.first_name + ' ' + c.last_name) };
        } catch (e) { out[k] = { error: String(e.message) }; }
      }
      // Also: what does Victor's record actually look like? find by dispatch via jobs
      const pool = await recentCustomers(ids.customer);
      out.pool_size = pool.length;
      out.pool_sample = pool.slice(0, 3).map((c) => c.first_name + ' | ' + c.last_name);
      return { statusCode: 200, body: JSON.stringify({ ok: true, customer_table: ids.customer, term, shapes: out }, null, 2) };
    }
    let query = qp.q || qp.query || '';
    if (!query && event.body) { try { query = (JSON.parse(event.body) || {}).query || ''; } catch (_) {} }
    const data = await run(query);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ success: false, error: String((e && e.message) || e) }) };
  }
};
