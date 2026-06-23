// cash-leads — the worklist for self-pay (cash) Quick Check leads.
//
// WHY: cash-pipeline.js only tracks Quick Checks that ALREADY PAID. The leads
// that come in off the website and DON'T finish (no payment, no photo, no
// model #) land in "Pending Review" and surface NOWHERE — Teddy only finds
// them when Danielle names one or he clicks job-by-job. (LeBlanc #19796 + James
// Preston #19819 were both invisible, 2026-06-22.) This lists every recent
// self-pay job, newest first, flagging what each one still needs, so abandoned
// carts get worked instead of lost.
//
//   GET /.netlify/functions/cash-leads?days=21         -> { ok, count, leads:[...] }
//   GET ...?include=all     -> include completed/canceled too (default: open only)
//
// Each lead: { job_id, name, phone, zip, appliance, model_number, has_model,
//   paid, status, created_ms, needs:[...] }. The page fetches photo counts per
//   card (get_job_attachments) so this stays fast.
'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');

function authHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function jsonResp(c, b) {
  return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) };
}

// Resolve customer + jobs table ids by FIELD shape (same approach as
// search-customers — the id maps conflict across the repo, so identify by
// columns, not by a hard-coded number). Cached per warm container.
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
    const looksCustomer = keys.includes('first_name') && keys.includes('last_name') && keys.includes('phone') && !keys.includes('conversation_id') && !keys.includes('customer_id');
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

const TERMINAL = new Set(['completed', 'canceled', 'cancelled', 'no_fix_possible']);

// Test/QA rows that pollute the worklist (ZZTEST*, *PartsLoop, *ChatCheck,
// "James Test"). Keep this tight so real customers are never dropped.
function isTestName(name) {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return false;
  if (/\bzztest|partsloop|chatcheck\b/.test(n)) return true;
  if (/^zztest/.test(n)) return true;
  if (n === 'james test') return true;
  return false;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return jsonResp(200, { ok: true });
  let ids;
  try { ids = await resolveIds(); } catch (e) { return jsonResp(200, { ok: false, error: String(e.message || e) }); }
  if (!ids.jobs) return jsonResp(200, { ok: false, error: 'could not resolve jobs table', resolved: ids });

  const qs = (event.queryStringParameters || {});
  const days = Math.max(1, Math.min(120, parseInt(qs.days || '21', 10) || 21));
  const includeAll = String(qs.include || '') === 'all';
  const sinceMs = Date.now() - days * 86400000;

  // Pull recent self-pay jobs (single-field exact search is the reliable
  // metadata shape). Newest first; cap generous so nothing recent is missed.
  let jobs = [];
  try {
    jobs = await searchPage(ids.jobs, { customer_type: 'self_pay' }, { id: 'desc' }, 200);
  } catch (e) { return jsonResp(200, { ok: false, error: 'job search failed: ' + String(e.message || e) }); }

  // Window + (default) open-only filter.
  const inWindow = jobs.filter((j) => {
    const ms = j.created_at ? new Date(j.created_at).getTime() : 0;
    if (ms && ms < sinceMs) return false;
    if (!includeAll && TERMINAL.has(String(j.current_status || '').toLowerCase())) return false;
    return true;
  });

  // Join customers (batch — one search per id is fine at this volume).
  const custIds = [...new Set(inWindow.map((j) => j.customer_id).filter(Boolean))];
  const custMap = new Map();
  if (ids.customer && custIds.length) {
    const rows = await Promise.all(custIds.map((cid) => searchPage(ids.customer, { id: cid }, null, 1).then((r) => r[0]).catch(() => null)));
    rows.forEach((c) => { if (c && c.id != null) custMap.set(c.id, c); });
  }

  const leads = inWindow.map((j) => {
    const c = custMap.get(j.customer_id) || {};
    const name = ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || 'Unknown';
    const hasModel = !!String(j.model_number || '').trim();
    const paid = !!j.payment_collected;
    const needs = [];
    if (!paid) needs.push('payment');
    if (!hasModel) needs.push('model #');
    return {
      job_id: j.id,
      name,
      phone: c.phone || '',
      zip: j.service_zip || c.zip || '',
      appliance: [j.brand, j.appliance_type].filter(Boolean).join(' ') || (j.appliance_type || ''),
      problem: j.problem_summary || '',
      model_number: j.model_number || '',
      has_model: hasModel,
      paid,
      status: j.friendly_status || j.current_status || '',
      created_ms: j.created_at ? new Date(j.created_at).getTime() : 0,
      needs,
    };
  }).filter((l) => !isTestName(l.name)).sort((a, b) => b.created_ms - a.created_ms);

  return jsonResp(200, { ok: true, window_days: days, count: leads.length, leads });
};
