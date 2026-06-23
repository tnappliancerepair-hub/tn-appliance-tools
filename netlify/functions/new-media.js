// new-media — board-wide feed of jobs that have customer/tech-uploaded media.
//
// WHY: photos + videos DO attach to their job and DO render in the Teddy Tool
// (verified 2026-06-22), but there's no single place to see "who just sent
// media." Teddy was clicking job-by-job and assuming uploads were lost. This
// lists every recent job that has at least one attachment, newest first, each a
// tap into the Teddy Tool — so an upload is never invisible "across the board."
//
//   GET /.netlify/functions/new-media?days=14&limit=120  -> { ok, count, items:[...] }
//
// Cheap: 1 metadata page for recent jobs + 1 list_attachment_counts call.
'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

function authHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function jsonResp(c, b) {
  return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) };
}

let _ids = null;
async function resolveIds() {
  if (_ids) return _ids;
  const candidates = [5, 6, 1, 2, 8, 9, 10, 7, 14, 16, 3, 4];
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
    const looksCustomer = keys.includes('first_name') && keys.includes('last_name') && keys.includes('phone') && !keys.includes('customer_id') && !keys.includes('conversation_id');
    const looksJobs = keys.includes('customer_id') && (keys.includes('scheduling_status') || keys.includes('customer_type'));
    if (!customer && looksCustomer) customer = id;
    if (!jobs && looksJobs) jobs = id;
  }
  _ids = { customer, jobs };
  return _ids;
}

async function searchPage(tableId, search, sort, perPage) {
  const body = { per_page: perPage || 100, page: 1 };
  if (search) body.search = search;
  if (sort) body.sort = sort;
  const r = await fetch(`${META}/table/${tableId}/content/search`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
  });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j && j.items) || [];
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return jsonResp(200, { ok: true });
  let ids;
  try { ids = await resolveIds(); } catch (e) { return jsonResp(200, { ok: false, error: String(e.message || e) }); }
  if (!ids.jobs) return jsonResp(200, { ok: false, error: 'could not resolve jobs table', resolved: ids });

  const qs = (event.queryStringParameters || {});
  const days = Math.max(1, Math.min(120, parseInt(qs.days || '14', 10) || 14));
  const limit = Math.max(20, Math.min(300, parseInt(qs.limit || '150', 10) || 150));
  const sinceMs = Date.now() - days * 86400000;

  // Recent jobs (newest first).
  let jobs = [];
  try { jobs = await searchPage(ids.jobs, null, { id: 'desc' }, limit); }
  catch (e) { return jsonResp(200, { ok: false, error: 'job pull failed: ' + String(e.message || e) }); }

  const recent = jobs.filter((j) => {
    const ms = j.created_at ? new Date(j.created_at).getTime() : 0;
    return !ms || ms >= sinceMs;
  });
  if (!recent.length) return jsonResp(200, { ok: true, count: 0, items: [] });

  // One call: attachment counts for all of them.
  let counts = [];
  try {
    const r = await fetch(`${XANO}/list_attachment_counts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_ids_csv: recent.map((j) => j.id).join(',') }),
    });
    const d = await r.json().catch(() => ({}));
    counts = (d && d.counts) || [];
  } catch (_) { counts = []; }
  const countMap = new Map(counts.map((c) => [Number(c.job_id), Number(c.count) || 0]));

  const withMedia = recent.filter((j) => (countMap.get(Number(j.id)) || 0) > 0);
  if (!withMedia.length) return jsonResp(200, { ok: true, count: 0, items: [] });

  // Join customers.
  const custIds = [...new Set(withMedia.map((j) => j.customer_id).filter(Boolean))];
  const custMap = new Map();
  if (ids.customer && custIds.length) {
    const rows = await Promise.all(custIds.map((cid) => searchPage(ids.customer, { id: cid }, null, 1).then((r) => r[0]).catch(() => null)));
    rows.forEach((c) => { if (c && c.id != null) custMap.set(c.id, c); });
  }

  const items = withMedia.map((j) => {
    const c = custMap.get(j.customer_id) || {};
    const name = ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || 'Unknown';
    return {
      job_id: j.id,
      name,
      appliance: [j.brand, j.appliance_type].filter(Boolean).join(' ') || (j.appliance_type || ''),
      problem: j.problem_summary || '',
      media_count: countMap.get(Number(j.id)) || 0,
      customer_type: j.customer_type || '',
      warranty_company: j.warranty_company || '',
      status: j.friendly_status || j.current_status || '',
      created_ms: j.created_at ? new Date(j.created_at).getTime() : 0,
    };
  }).sort((a, b) => b.created_ms - a.created_ms);

  return jsonResp(200, { ok: true, count: items.length, items });
};
