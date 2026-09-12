// platform-vendor-product-sync — ask the WARRANTY COMPANY what machine this dispatch is for,
// and write the answer onto the platform so the intake splitter stops guessing.
//
// WHY THIS EXISTS. Of the first 17 intake-split flags, five were a single cabinet holding a
// washer AND a dryer — the ticket named one half, the complaint named the other. In the text
// alone that is indistinguishable from a ticket on the wrong machine, and we flagged all five
// as if a human had to go sort them out. They didn't: SquareTrade's own claim record calls
// them "COMBO WASHER DRYER" and PAID every one ($105, $150, …).
//
// So the authority already exists and we were not reading it. The claim carries `product` and
// `model` straight from the vendor — no inference, no parsing of prose.
//
// ⚠️ STORED AS AN `event` ROW, NOT ON unit.attributes. The mirror rebuilds unit.attributes
// WHOLE on every run from {brand, appliance, model, serial} (merge-duplicates replaces a jsonb
// column, it does not merge into it), so anything extra written there is silently gone within
// five minutes. An event row is mirror-proof and needs no schema change — the same reason the
// flags themselves live there.
//
// ⚠️ SCOPE IS DELIBERATELY TINY. It asks the vendor ONLY about jobs that currently carry an
// unresolved flag AND are a washer+dryer pair we have no machine evidence for. That is one or
// two jobs, not a backlog sweep — a per-dispatch SOAP/REST round trip is 1-3s and the reason
// to make the call at all is to answer a question a human is otherwise being asked.
//
// ⚠️ THE CLAIM API ONLY RETURNS SUBMITTED CLAIMS ("No records found" until then). So this
// settles history and anything already worked; a brand-new dispatch is covered by the MODEL
// rule in _lib/multi-appliance instead. Where neither is available the flag correctly stands.
//
// It writes nothing to the job, nothing to the customer, and never to the vendor.
//
//   GET ?secret=<admin>            shadow — what it WOULD learn
//   GET ?secret=<admin>&apply=1    write vendor_product_known rows
//   GET ?secret=<admin>&all=1      every flagged job, not just the ones lacking evidence
//   Kill switch: vault PLATFORM_VENDOR_PRODUCT_ENABLED=false
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { detect, comboOneMachine } = require('./_lib/multi-appliance');
const spClaims = require('./_lib/servicepower-claims');

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const FLAG = 'multi_appliance_suspected';
const RESOLVED = 'multi_appliance_resolved';
const VENDOR = 'vendor_product_known';
// Netlify gives the function 26s. Stop asking the vendor with room to still write what we
// learned — a run that dies mid-loop has made the calls and kept none of the answers.
const BUDGET_MS = 19000;

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

async function runVendorProduct(opts) {
  const o = opts || {};
  const apply = !!o.apply;
  const started = Date.now();

  const enabled = String((await getSecretFresh('PLATFORM_VENDOR_PRODUCT_ENABLED')) || 'true').toLowerCase() !== 'false';
  if (apply && !enabled) return { ok: true, disabled: true, note: 'PLATFORM_VENDOR_PRODUCT_ENABLED=false' };

  const base = String((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!base || !key) return { ok: false, error: 'platform_not_configured' };
  const SB = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

  async function get(path) {
    try {
      const r = await fetch(`${base}/rest/v1/${path}`, { headers: SB, signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      return await r.json().catch(() => null);
    } catch (_) { return null; }
  }

  if (!(await spClaims.isConfigured())) return { ok: false, error: 'servicepower_not_configured' };

  // every flag ever raised, plus what has since been settled or already learned
  const evs = await get(`event?company_id=eq.${TN_COMPANY}&type=in.(${FLAG},${RESOLVED},${VENDOR})&select=type,payload&order=id.asc`);
  if (evs === null) return { ok: false, error: 'flag_read_failed' };
  const open = new Set(); const settled = new Set(); const known = new Set();
  for (const e of evs) {
    const id = e && e.payload && e.payload.job_id; if (!id) continue;
    if (e.type === FLAG) open.add(String(id));
    else if (e.type === RESOLVED) settled.add(String(id));
    else known.add(String(id));
  }
  const targets = [...open].filter((id) => !settled.has(id) && !known.has(id));

  const res = {
    ok: true, mode: apply ? 'live' : 'dryrun',
    open_flags: open.size, already_known: known.size, asked: 0, learned: 0,
    skipped: { no_claim: 0, not_a_laundry_pair: 0, evidence_already: 0, no_claim_record: 0 },
    disagreements: [], rows: [], errors: 0, out_of_budget: false,
  };

  for (const jobId of targets) {
    if (Date.now() - started > BUDGET_MS) { res.out_of_budget = true; break; }

    const rows = await get(`job?id=eq.${jobId}&select=${encodeURIComponent('id,problem,claim_number,unit:unit_id(label,attributes)')}`);
    const j = Array.isArray(rows) ? rows[0] : null;
    if (!j) { res.errors++; continue; }
    const label = (j.unit && j.unit.label) || '';
    const attrs = (j.unit && j.unit.attributes) || {};

    if (!String(j.claim_number || '').trim()) { res.skipped.no_claim++; continue; }

    // Only spend a vendor round trip where it can actually change the answer.
    if (!o.all) {
      const d = detect(label, j.problem, { model: attrs.model });
      const pair = (d.appliances || []).length === 2
        && d.appliances.indexOf('washer') >= 0 && d.appliances.indexOf('dryer') >= 0;
      if (!pair) { res.skipped.not_a_laundry_pair++; continue; }
      if (comboOneMachine(d.appliances, { model: attrs.model })) { res.skipped.evidence_already++; continue; }
    }

    let claim = null;
    res.asked++;
    try {
      // retrieveClaims already hands back NORMALISED rows (it maps normClaim internally).
      // Running normClaim over them a second time reads camelCase keys that are no longer
      // there and quietly produces an empty product — which looks exactly like "no claim on
      // file". Cost a full deploy cycle; do not re-normalise.
      const out = await spClaims.retrieveClaims({ callNumber: String(j.claim_number).trim() });
      claim = (out && Array.isArray(out.claims)) ? (out.claims[0] || null) : null;
    } catch (_) { res.errors++; continue; }

    if (!claim || !String(claim.product || '').trim()) { res.skipped.no_claim_record++; continue; }

    const row = {
      job_id: j.id, claim: String(j.claim_number).trim(),
      product: String(claim.product || '').trim(),
      model: String(claim.model || '').trim() || null,
      brand: String(claim.brand || '').trim() || null,
      status: claim.status_description || null,
      our_label: label, our_model: attrs.model || null,
      source: 'servicepower_claim',
    };
    res.rows.push(row);

    // Worth saying out loud even when it isn't a combo: if the vendor names a different
    // machine than our ticket, the vendor is the one being billed and we are the outlier.
    const ourAppliance = String(attrs.appliance || '').toLowerCase();
    if (ourAppliance && !row.product.toLowerCase().includes(ourAppliance)) {
      res.disagreements.push({ job_id: j.id, our_ticket: label, vendor_says: row.product });
    }

    if (!apply) { res.learned++; continue; }
    try {
      const w = await fetch(`${base}/rest/v1/event`, {
        method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, SB),
        body: JSON.stringify({ company_id: TN_COMPANY, type: VENDOR, entity: 'job', payload: row }),
        signal: AbortSignal.timeout(12000),
      });
      if (w.ok) res.learned++; else res.errors++;
    } catch (_) { res.errors++; }
  }

  return res;
}

exports.config = { timeout: 26 };
exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== guard) return json(403, { ok: false, error: 'forbidden — ?secret=' });
  return json(200, await runVendorProduct({ apply: q.apply === '1', all: q.all === '1' }));
};
exports.runVendorProduct = runVendorProduct;
