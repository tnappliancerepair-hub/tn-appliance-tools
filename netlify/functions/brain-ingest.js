// brain-ingest — the ongoing contribution sweep into the shared brain (SHADOW: fills the
// corpus, nothing reads yet). Runs both feeds server-side (service keys stay off the browser):
//   A) TN: insert-select from ANT OPS brain_predictions (graded eval rows) -> brain_outcome.
//   B) Platform: read each tenant's completed job_tdr rows from ANT Platforms, de-identify,
//      insert into ANT OPS brain_outcome scoped by contributed_by=company_id.
// AUTOMATED BULK POLICY: structured fields only — symptom is DROPPED (zero PII risk). The
// scrubbed-symptom path lives only in brain-contribute, where the caller passes known PII.
// Idempotent on dedup_key. Best-effort: a failure in one feed never blocks the other.
//
//   POST/GET ?secret=<admin>       (also self-authorizes on the Netlify schedule)
'use strict';
const { getSecret } = require('./_lib/secrets');
const { deriveFamily } = require('./_lib/brain-deid');
const MGMT = 'https://api.supabase.com/v1';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function refFromUrl(u) { const m = String(u || '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i); return m ? m[1] : ''; }
exports.config = { timeout: 26 };
function fixedFrom(outcome) {
  const o = String(outcome || '').toLowerCase();
  if (/fix|complet|repair|done/.test(o)) return true;
  if (/replace|not[_\s-]?fix|no[_\s-]?fix|unrepair|beyond/.test(o)) return false;
  return null;
}

// TN feed: same filtered, PII-safe insert-select we verified by hand, run via the mgmt API.
const TN_SQL = `
insert into public.brain_outcome
  (source, contributed_by, appliance, brand, model, platform_family, symptom,
   failed_component, part_number, fault_code, fixed_first_trip, fixed, dedup_key)
select 'tn','tn-appliance',
  nullif(lower(trim(p.appliance)),''), nullif(trim(p.brand),''), nullif(trim(p.model),''),
  nullif(regexp_replace(upper(regexp_replace(coalesce(p.model,''),'[\\s-]','','g')),
         '([A-Z0-9]{5,}?)([0-9]{1,2})$','\\1'),''),
  null, nullif(trim(p.actual_component),''), nullif(trim(p.actual_part),''), null, null, true,
  'tn:job:'||coalesce(p.job_id::text,p.id::text)||':'||md5(coalesce(p.actual_part,''))
from public.brain_predictions p
where p.graded_at is not null
  and coalesce(trim(p.actual_part),'') <> ''
  and length(trim(p.actual_part)) between 4 and 30
  and trim(p.actual_part) ~ '[A-Za-z]' and trim(p.actual_part) ~ '[0-9]'
  and trim(p.actual_part) !~* 'not fixable|no part|n/?a|none|unknown|replace(d)? (unit|appliance)'
  and coalesce(trim(p.model),'') <> ''
on conflict (dedup_key) do nothing;`;

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (!scheduled && q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });

  const mgmt = await getSecret('SUPABASE_MGMT_TOKEN');
  const opsUrl = (await getSecret('SUPABASE_URL')) || '';
  const opsKey = (await getSecret('SUPABASE_SERVICE_KEY')) || '';
  const opsRef = refFromUrl(opsUrl);
  const platUrl = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const platKey = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  const out = { ok: true, shadow: true, tn: null, platform: null };

  // ---- A) TN feed (single-DB insert-select via mgmt) ----
  if (mgmt && opsRef) {
    try {
      const r = await fetch(`${MGMT}/projects/${opsRef}/database/query`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + mgmt, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: TN_SQL + '\nselect count(*) as tn_total from public.brain_outcome where source=\'tn\';' }),
        signal: AbortSignal.timeout(15000),
      });
      const d = await r.json().catch(() => null);
      out.tn = { ran: r.ok, tn_total: Array.isArray(d) && d[0] ? d[0].tn_total : null };
    } catch (e) { out.tn = { ran: false, error: String((e && e.message) || e).slice(0, 120) }; }
  } else { out.tn = { ran: false, error: 'ops mgmt not configured' }; }

  // ---- B) Platform sweep (cross-DB: read Platforms job_tdr -> write ANT OPS) ----
  if (platUrl && platKey && opsUrl && opsKey) {
    try {
      const sel = 'company_id,job_id,appliance,brand,model,failed_component,part_number,outcome';
      const filt = 'or=(failed_component.not.is.null,part_number.not.is.null)';
      const r = await fetch(`${platUrl}/rest/v1/job_tdr?${filt}&select=${sel}&order=updated_at.desc&limit=1000`,
        { headers: { apikey: platKey, Authorization: 'Bearer ' + platKey }, signal: AbortSignal.timeout(12000) });
      const rows = r.ok ? (await r.json().catch(() => [])) : [];
      const corpusRows = rows
        .filter((t) => (t.failed_component && String(t.failed_component).trim()) || (t.part_number && String(t.part_number).trim()))
        .map((t) => ({
          source: 'platform',
          contributed_by: String(t.company_id || ''),           // internal only
          appliance: (t.appliance || '').toString().toLowerCase().trim().slice(0, 40) || null,
          brand: (t.brand || '').toString().trim().slice(0, 40) || null,
          model: (t.model || '').toString().trim().slice(0, 60) || null,
          platform_family: deriveFamily(t.model) || null,
          symptom: null,                                          // dropped (bulk policy)
          failed_component: (t.failed_component || '').toString().trim().slice(0, 80) || null,
          part_number: (t.part_number || '').toString().trim().slice(0, 60) || null,
          fault_code: null,
          fixed_first_trip: null,
          fixed: fixedFrom(t.outcome),
          dedup_key: `platform:${t.company_id}:${t.job_id}`,
        }));
      let wrote = 0;
      if (corpusRows.length) {
        const ir = await fetch(`${opsUrl.replace(/\/+$/, '')}/rest/v1/brain_outcome`, {
          method: 'POST',
          headers: { apikey: opsKey, Authorization: 'Bearer ' + opsKey, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(corpusRows), signal: AbortSignal.timeout(15000),
        });
        wrote = ir.ok ? corpusRows.length : 0;
        if (!ir.ok) { let d = ''; try { d = await ir.text(); } catch (_) {} out.platform_err = d.slice(0, 150); }
      }
      out.platform = { read: rows.length, learnable: corpusRows.length, upserted: wrote };
    } catch (e) { out.platform = { ran: false, error: String((e && e.message) || e).slice(0, 120) }; }
  } else { out.platform = { ran: false, error: 'platform/ops not configured' }; }

  return json(200, out);
};
