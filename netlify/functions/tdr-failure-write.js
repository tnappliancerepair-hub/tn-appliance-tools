// tdr-failure-write — create a tdr_failure row directly via the Metadata API, so the
// customer-facing 4-option quote (qc_diagnosis_view → cash-tdr-customer.html) populates
// even though the add_tdr_failure XS endpoint isn't deployed. Admin-gated.
//
//   GET  ?secret=&probe=1                  find the tdr_failure table + show a sample row's columns
//   POST ?secret=  { tdr_id, job_id, failed_component, failure_description,
//                    oem_part_number, amazon_part_number,
//                    oem_part_our_cost_cents, amazon_part_our_cost_cents,
//                    labor_customer_cost_cents }
'use strict';
const { getSecret } = require('./_lib/secrets');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function H() { return { Authorization: 'Bearer ' + process.env.XANO_METADATA_TOKEN, 'Content-Type': 'application/json' }; }

// scan table ids for the one whose rows look like tdr_failure (has the cost columns)
async function findTable() {
  for (let id = 1; id <= 80; id++) {
    try {
      const r = await fetch(`${META}/table/${id}/content/search`, { method: 'POST', headers: H(), body: JSON.stringify({ per_page: 1, page: 1 }) });
      if (!r.ok) continue;
      const row = ((await r.json()).items || [])[0];
      if (row && ('oem_part_our_cost_cents' in row || 'amazon_part_our_cost_cents' in row) && ('failure_description' in row || 'failed_component' in row)) {
        return { id, sample_keys: Object.keys(row) };
      }
    } catch (_) {}
  }
  return null;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (!process.env.XANO_METADATA_TOKEN) return json(500, { ok: false, error: 'no metadata token' });

  const t = await findTable();
  if (!t) return json(200, { ok: false, error: 'could not locate tdr_failure table' });

  if (event.httpMethod !== 'POST' || q.probe === '1') return json(200, { ok: true, table_id: t.id, columns: t.sample_keys });

  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  // build the row using ONLY columns that exist on the table (from the sample)
  const cols = new Set(t.sample_keys);
  const want = {
    tdr_id: b.tdr_id, technician_decision_report_id: b.tdr_id,
    job_id: b.job_id,
    failure_description: b.failure_description || '',
    failed_component: b.failed_component || '',
    oem_part_number: b.oem_part_number || '',
    amazon_part_number: b.amazon_part_number || '',
    oem_part_our_cost_cents: Number(b.oem_part_our_cost_cents) || 0,
    amazon_part_our_cost_cents: Number(b.amazon_part_our_cost_cents) || 0,
    labor_customer_cost_cents: Number(b.labor_customer_cost_cents) || 0,
  };
  const row = {};
  for (const k of Object.keys(want)) if (cols.has(k) && want[k] != null) row[k] = want[k];

  let r, d;
  try { r = await fetch(`${META}/table/${t.id}/content`, { method: 'POST', headers: H(), body: JSON.stringify(row) }); d = await r.json().catch(() => ({})); }
  catch (e) { return json(200, { ok: false, error: String(e.message || e) }); }
  return json(200, { ok: r.ok, table_id: t.id, wrote: row, id: d && (d.id || (d.created && d.created.id)) || null, error: r.ok ? null : d });
};
