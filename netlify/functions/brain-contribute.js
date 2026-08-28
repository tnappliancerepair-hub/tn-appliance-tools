// brain-contribute — the contribution path into the shared brain. A completed job/TDR from
// ANY tenant (TN or a platform shop) comes in; it is de-identified (brain-deid) and ONE row is
// written to brain_outcome in ANT OPS. Idempotent on dedup_key (a later grade refreshes the
// row). Server-side only, admin-gated. `&dry=1` returns exactly what WOULD be stored without
// writing — the shadow-verification tool: prove the de-id is airtight before any tenant reads.
//
//   POST ?secret=<admin>[&dry=1]
//   body: { source, contributed_by, job:{...structured fields...}, pii:{name,phone,email,address,city,zip} }
'use strict';
const { getSecret } = require('./_lib/secrets');
const { extractOutcome } = require('./_lib/brain-deid');
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const job = body.job || {};
  const pii = body.pii || {};
  const row = extractOutcome(job, pii, {
    source: body.source, contributed_by: body.contributed_by, dedup_key: body.dedup_key,
  });
  if (!row) return json(200, { ok: false, skipped: 'nothing_learnable', note: 'no failed_component and no part_number' });

  // strip the internal-only debug field before it could ever be stored/returned as data
  const redactions = row._redactions; delete row._redactions;

  if (q.dry === '1') {
    // shadow verification: show the caller-supplied PII AND the de-identified result so we can
    // confirm by eye that no identifier survived. contributed_by is internal but shown here to
    // the operator (admin-gated), never to a tenant.
    return json(200, { ok: true, dry_run: true, redactions_made: redactions, would_store: row, pii_seen: pii });
  }

  const base = (await getSecret('SUPABASE_URL')) || '';
  const key = (await getSecret('SUPABASE_SERVICE_KEY')) || '';
  if (!base || !key) return json(200, { ok: false, error: 'ANT OPS not configured' });
  try {
    const r = await fetch(`${base.replace(/\/+$/, '')}/rest/v1/brain_outcome`, {
      method: 'POST',
      headers: {
        apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { let d = ''; try { d = await r.text(); } catch (_) {} return json(200, { ok: false, error: 'insert ' + r.status, detail: d.slice(0, 200) }); }
    return json(200, { ok: true, contributed: true, redactions_made: redactions, family: row.platform_family, dedup_key: row.dedup_key });
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
