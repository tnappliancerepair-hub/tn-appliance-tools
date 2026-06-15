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

function nameVariants(tok) {
  const lower = tok.toLowerCase();
  const title = lower.charAt(0).toUpperCase() + lower.slice(1);
  const upper = lower.toUpperCase();
  return [...new Set([title, upper, lower, tok])];
}

async function run(query) {
  const ids = await resolveIds();
  if (!ids.customer) return { success: false, error: 'could not resolve customer table id', resolved: ids };

  const q = String(query || '').trim();
  if (!q) return { success: false, error: 'query required' };
  const digits = q.replace(/[^0-9]/g, '');
  const map = new Map();

  // Phone branch
  if (digits.length >= 7) {
    const last10 = digits.slice(-10);
    const phoneForms = [...new Set([digits, last10, '+1' + last10])];
    const results = await Promise.all(phoneForms.map((p) => searchField(ids.customer, 'phone', p, 15)));
    results.forEach((rows) => uniqByIdPush(map, rows));
  }

  // Name branch — every token (so middle names don't hide the last name),
  // each as first_name AND last_name, in Title/UPPER/lower (Xano exact match
  // is case-sensitive; warranty names are stored mixed-case).
  if (digits.length < q.length) {
    const tokens = q.split(/\s+/).filter((t) => t.length >= 2).slice(0, 4);
    const jobs = [];
    for (const tok of tokens) {
      for (const v of nameVariants(tok)) {
        jobs.push(searchField(ids.customer, 'last_name', v, 15));
        jobs.push(searchField(ids.customer, 'first_name', v, 15));
      }
    }
    const results = await Promise.all(jobs);
    results.forEach((rows) => uniqByIdPush(map, rows));
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
    let query = qp.q || qp.query || '';
    if (!query && event.body) { try { query = (JSON.parse(event.body) || {}).query || ''; } catch (_) {} }
    const data = await run(query);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ success: false, error: String((e && e.message) || e) }) };
  }
};
