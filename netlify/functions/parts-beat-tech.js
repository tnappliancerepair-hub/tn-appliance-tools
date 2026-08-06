// parts-beat-tech — order the part BEFORE the tech arrives, so it beats him to the
// customer's door = one-trip fix (the first-visit-fix lever, the single biggest
// efficiency win in the shop). Once a CASH / self-pay job is pre-diagnosed with a
// confident part number, this finds it, pulls the LIVE Marcone ETA, and decides
// whether that part will beat the scheduled visit.
//
// WARRANTY IS EXCLUDED BY DESIGN. On a warranty job (AHS/ServicePower/SquareTrade,
// ~95% of volume) the WARRANTY VENDOR supplies the part — ordering it ourselves
// breaks the claim/reimbursement. Those are handled by the parts-watch feeds
// (ahs-parts-watch / servicepower-parts-watch) which already record what the vendor
// ships; the warranty timing play (ETA-vs-visit alerting) is Phase 2, not here.
//
// This automates the CASH path, which is 100% ours to order + drop-ship.
//
// SAFETY — real money, ships to customer HOMES, so it starts inert:
//   SHADOW (default): identifies candidates, gets live ETAs, computes "beats the
//     visit?", and LOGS the plan. Creates NOTHING, buys NOTHING, texts no customer.
//   This build is shadow-only on purpose. The live create/place path is designed in
//   docs/parts-beat-tech-plan-2026-08-06.md and waits on Teddy's decisions (cash
//   approval gate + auto-vs-one-tap). Once decided it reuses the EXISTING placer
//   (parts-autoplace) — this file never buys anything directly.
//
//   GET ?secret=<admin>[&dry=1]   manual run   ·   scheduled runs self-authorize.
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const msupply = require('./_lib/msupply');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const PARTS_ORDERS = 47;
const CASH_TYPES = new Set(['self_pay', 'cash', 'customer_pay', 'self pay']);
// Order early enough that the part lands at least this many days before the visit.
const BUFFER_DAYS = 1;
// Cap live Marcone lookups per run (each is a real ~1-2s API call) so we never blow
// the timeout; the cron works the rest next pass.
const MAX_LOOKUPS = 20;

exports.config = { timeout: 26 };

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b, null, 2) }; }
async function verifyOffice(password) {
  if (!password) return false;
  try { const r = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(8000) }); if (!r.ok) return false; const d = await r.json().catch(() => ({})); return !!(d && (d.success || d.ok || d.valid || d.authorized || d === true)); } catch (_) { return false; }
}
function dayMs(v) { const t = typeof v === 'number' ? v : Date.parse(String(v || '')); return isFinite(t) ? t : 0; }
function daysBetween(aMs, bMs) { return Math.round((bMs - aMs) / 86400000); }

// One call gives us BOTH the confident part number and the customer ship-to address.
// (Same context endpoint parts-autoplace uses — works for any job, warranty or cash.)
async function jobContext(jobId) {
  try {
    return await fetch(`${XANO}/get_warranty_submission_context?job_id=${jobId}`, { signal: AbortSignal.timeout(9000) }).then((x) => x.json());
  } catch (_) { return null; }
}
function pickPart(ctx) {
  const fs = (ctx && ctx.tdr_failures) || [];
  const f = fs.find((x) => x.oem_part_number || x.verified_part_number);
  return (f && (f.oem_part_number || f.verified_part_number || '')).toString().trim();
}

// The identify logic, shared by the scheduled handler AND the non-scheduled office
// reader (parts-beat-tech-queue) — because Netlify 403s manual HTTP to a scheduled fn.
async function buildQueue() {
  // Candidates: jobs a pre-diagnosis flagged as needing a part (flag-parts-to-order
  // sets parts_status='to_order' and skips once an ETA/order exists — so this set is
  // exactly "pre-diagnosed, has a part, not yet ordered").
  let jobs = [];
  try { jobs = await crud.searchPage(crud.TABLES.jobs, { parts_status: 'to_order' }, { id: 'desc' }, 150); }
  catch (e) { return json(200, { ok: false, error: 'job query failed: ' + String((e && e.message) || e) }); }

  const plan = [];
  const skipped = { warranty: 0, already_ordered: 0, no_part: 0, no_customer: 0 };
  let lookups = 0;

  for (const job of jobs) {
    const jobId = Number(job.id || 0);
    if (!jobId) continue;

    // FORK: cash only. Warranty parts are vendor-supplied — never order them here.
    const ct = String(job.customer_type || '').toLowerCase();
    if (!CASH_TYPES.has(ct)) { skipped.warranty++; continue; }

    // Job-level dedup: if this job already has ANY parts_orders row, it's handled.
    try {
      const existing = await crud.searchPage(PARTS_ORDERS, { job_id: jobId }, { id: 'desc' }, 3);
      if (existing && existing.length) { skipped.already_ordered++; continue; }
    } catch (_) {}

    const ctx = await jobContext(jobId);
    const part = pickPart(ctx);
    if (!part) { skipped.no_part++; continue; }   // only order a human-confirmed part

    const cust = (ctx && ctx.customer) || {};
    const who = [cust.first_name, cust.last_name].filter(Boolean).join(' ');
    const shipCity = cust.city || job.service_city || '';
    const zip = cust.zip || cust.zip_code || job.service_zip || '';
    const hasAddr = !!(cust.address_line1 || cust.address || job.service_address);
    if (!hasAddr) skipped.no_customer++; // still surface it (office can add the address)

    // Live Marcone ETA (read-only). Capped per run.
    let inStock = null, etaDays = null, lookupErr = '';
    if (lookups < MAX_LOOKUPS) {
      lookups++;
      try {
        const r = await msupply.lookupPart(part, job.brand || '', { zip: String(zip || '').slice(0, 5) });
        if (r && r.ok) { inStock = !!r.in_stock; etaDays = r.eta_days; }
        else lookupErr = (r && r.error) || 'lookup_failed';
      } catch (e) { lookupErr = String((e && e.message) || e); }
    }

    // Timing verdict: does the part beat the scheduled visit?
    const visitMs = dayMs(job.scheduled_start);
    let beats = null, arriveInDays = null;
    if (etaDays != null) {
      arriveInDays = etaDays;
      if (visitMs) {
        const daysToVisit = daysBetween(Date.now(), visitMs);
        beats = (etaDays + BUFFER_DAYS) <= daysToVisit;
      }
      // no scheduled visit yet -> beats=null = "order now, then schedule around arrival"
    }

    plan.push({
      job_id: jobId, who, ship_city: shipCity, has_ship_address: hasAddr,
      part, brand: job.brand || '', appliance: job.appliance_type || '',
      in_stock: inStock, eta_days: etaDays, arrive_in_days: arriveInDays,
      scheduled: job.scheduled_start || null,
      beats_visit: beats, // true = part lands before tech; false = will MISS (reschedule); null = not-yet-scheduled or ETA unknown
      lookup_error: lookupErr || undefined,
    });
  }

  const willBeat = plan.filter((p) => p.beats_visit === true).length;
  const willMiss = plan.filter((p) => p.beats_visit === false).length;
  const notScheduled = plan.filter((p) => p.beats_visit === null && p.eta_days != null).length;

  const out = {
    ok: true, mode: 'shadow',
    note: 'SHADOW — identifies + times only, orders nothing. Live create/place path pending Teddy decisions (see docs/parts-beat-tech-plan-2026-08-06.md).',
    cash_candidates: plan.length,
    beats_visit: willBeat, will_miss_visit: willMiss, not_yet_scheduled: notScheduled,
    warranty_skipped: skipped.warranty,       // vendor supplies these — by design
    already_ordered_skipped: skipped.already_ordered,
    no_confident_part_skipped: skipped.no_part,
    no_ship_address: skipped.no_customer,
    lookups_used: lookups,
    plan: plan.slice(0, 30),
  };
  return out;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin && !(q.office && await verifyOffice(q.office))) return json(401, { ok: false, error: 'unauthorized — ?secret= or ?office=' });
  if (String(await getSecret('PARTS_BEAT_TECH') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  let out;
  try { out = await buildQueue(); } catch (e) { return json(200, { ok: false, error: String((e && e.message) || e) }); }
  try { await crud.logEvent('parts_beat_tech_run', { mode: 'shadow', cash_candidates: out.cash_candidates, beats: out.beats_visit, miss: out.will_miss_visit, warranty_skipped: out.warranty_skipped, at_ms: Date.now() }); } catch (_) {}
  return json(200, out);
};

module.exports.buildQueue = buildQueue;
module.exports.verifyOffice = verifyOffice;
