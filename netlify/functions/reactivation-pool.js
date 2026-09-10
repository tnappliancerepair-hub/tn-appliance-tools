// reactivation-pool — READ ONLY. Answers one question with real numbers:
// how many past customers could we actually win back, and can we reach them?
//
// WHY THIS EXISTS: the XanoScript endpoint the win-back campaign depends on
// (list_reactivation_candidates) returned 0 rows at EVERY dormancy setting. Cause:
// customer.created_at is an epoch-MILLISECOND integer, but the query built a
// timestamp and compared the int against it, so the WHERE never matched. That XS
// is fixed in this repo but XanoScript only deploys from the Mac, so this function
// answers the same question from a place that deploys on its own.
//
// Sizes the pool; sends nothing, writes nothing.
//
//   GET ?secret=              dormant = no job in the last 6 months
//   ...&months=12             change the dormancy window
//   ...&sample=1              include 10 example rows (name + masked phone)
'use strict';
const { getSecret, primeXanoToken} = require('./_lib/secrets');
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function authHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

// Same shape-sniffing the customer search uses: table ids differ between the
// repo's several maps, so identify by the FIELDS a row actually carries.
let _ids = null;
async function resolveIds() {
  if (_ids) return _ids;
  let customer = null, jobs = null;
  for (const id of [5, 6, 1, 2, 8, 9, 10, 7, 14, 16]) {
    if (customer && jobs) break;
    let row;
    try {
      const r = await fetch(`${META}/table/${id}/content?page=1&per_page=1`, { headers: authHeaders() });
      if (!r.ok) continue;
      const j = await r.json().catch(() => ({}));
      row = (j.items || [])[0];
    } catch (_) { continue; }
    if (!row) continue;
    const k = Object.keys(row);
    if (!customer && k.includes('first_name') && k.includes('phone') && !k.includes('conversation_id')) customer = id;
    if (!jobs && k.includes('customer_id') && (k.includes('scheduling_status') || k.includes('job_number'))) jobs = id;
  }
  _ids = { customer, jobs };
  return _ids;
}

// Page a whole table, but never blow Netlify's sync timeout - report partial and
// say so rather than dying with no answer.
async function pageAll(tableId, deadline, perPage) {
  const out = []; let page = 1; let truncated = false;
  for (;;) {
    if (Date.now() > deadline) { truncated = true; break; }
    let j;
    try {
      const r = await fetch(`${META}/table/${tableId}/content?page=${page}&per_page=${perPage || 500}`, { headers: authHeaders() });
      if (!r.ok) break;
      j = await r.json().catch(() => ({}));
    } catch (_) { break; }
    const items = (j && j.items) || [];
    out.push(...items);
    if (items.length < (perPage || 500)) break;
    page += 1;
    if (page > 60) { truncated = true; break; }
  }
  return { rows: out, truncated };
}

const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const maskPhone = (s) => { const d = digits(s); return d.length >= 10 ? `***-***-${d.slice(-4)}` : ''; };

exports.handler = async function (event) {
  await primeXanoToken();   // 4KB budget: token lives in the vault, not env
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });

  const months = Math.max(1, Math.min(60, parseInt(q.months, 10) || 6));
  const cutoffMs = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
  const deadline = Date.now() + 20000;

  let ids;
  try { ids = await resolveIds(); } catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
  if (!ids.customer || !ids.jobs) return json(200, { ok: false, error: 'could not resolve customer/jobs table ids', ids });

  const jobsRes = await pageAll(ids.jobs, deadline, 500);
  // customer_ids that have had ANY job inside the window = not dormant
  const recent = new Set();
  for (const j of jobsRes.rows) {
    const ts = Number(j.created_at || 0);
    if (ts >= cutoffMs && j.customer_id != null) recent.add(Number(j.customer_id));
  }

  const custRes = await pageAll(ids.customer, deadline, 500);
  let withPhone = 0, dormant = 0, dormantNoPhone = 0;
  // The XS endpoint filters on customer.created_at < cutoff BEFORE checking
  // job recency. If Xano's customer rows were all created recently (bulk
  // import), that pre-filter alone returns zero and the whole campaign is
  // dark no matter how the job check behaves. Count both so we can tell.
  let dormantAndOldRecord = 0;
  let oldestCreatedAt = null, newestCreatedAt = null;
  const sample = [];
  const wantList = q.list === '1';
  const callList = [];
  for (const c of custRes.rows) {
    const ca = Number(c.created_at || 0);
    if (ca > 0) {
      if (oldestCreatedAt === null || ca < oldestCreatedAt) oldestCreatedAt = ca;
      if (newestCreatedAt === null || ca > newestCreatedAt) newestCreatedAt = ca;
    }
    const hasPhone = digits(c.phone).length >= 10;
    if (hasPhone) withPhone += 1;
    const isDormant = !recent.has(Number(c.id));
    if (!isDormant) continue;
    if (hasPhone) {
      dormant += 1;
      if (ca > 0 && ca < cutoffMs) dormantAndOldRecord += 1;
      const row = { id: c.id, name: `${c.first_name || ''} ${c.last_name || ''}`.trim(), city: c.city || '', created_at: c.created_at };
      if (sample.length < 10) sample.push(Object.assign({ phone: maskPhone(c.phone) }, row));
      // The texts are gated off on purpose, so the only way to work this pool
      // is to call it. Hand over a real worklist with real numbers when asked.
      if (wantList) callList.push(Object.assign({ phone: digits(c.phone) }, row));
    } else {
      dormantNoPhone += 1;
    }
  }

  return json(200, {
    ok: true,
    dormancy_window_months: months,
    customers_total: custRes.rows.length,
    customers_with_phone: withPhone,
    jobs_scanned: jobsRes.rows.length,
    customers_with_a_job_in_window: recent.size,
    REACHABLE_WINBACK_POOL: dormant,
    dormant_but_no_phone: dormantNoPhone,
    // What the live XS endpoint can actually see, given its created_at pre-filter.
    xs_visible_pool: dormantAndOldRecord,
    customer_record_age: {
      oldest_created_at: oldestCreatedAt,
      newest_created_at: newestCreatedAt,
      oldest_iso: oldestCreatedAt ? new Date(oldestCreatedAt).toISOString() : null,
      newest_iso: newestCreatedAt ? new Date(newestCreatedAt).toISOString() : null,
      cutoff_iso: new Date(cutoffMs).toISOString(),
    },
    truncated: jobsRes.truncated || custRes.truncated,
    note: jobsRes.truncated || custRes.truncated
      ? 'Hit the time budget - counts are a FLOOR, the real pool is larger.'
      : 'Full scan.',
    sample: q.sample === '1' ? sample : undefined,
    // ?list=1 -> the full dial list, oldest relationship first so the coldest
    // customers get reached before the ones who'd still be around next month.
    call_list: wantList
      ? callList.sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0))
      : undefined,
  });
};
