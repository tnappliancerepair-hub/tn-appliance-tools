// platform-claim-context — assemble the warranty-claim context for a job STRAIGHT OFF THE
// PLATFORM (Supabase), so filing a claim no longer needs Xano.
//
// WHY THIS EXISTS
// The claim builder read ONE Xano endpoint (`get_warranty_submission_context`). That single
// read is what kept warranty claim submission — the money lane — tied to the old system.
// The platform already holds every field it returned, and holds the parts data BETTER:
//   · must_return  ← the VENDOR's own rule, pulled off the ServicePower API per part
//   · disposition  ← what the TECH actually did at the stop (used / return / not_here)
//   · ship_tracking / ship_carrier ← the outbound shipment
// The email-only path could only ever know a part existed if its email arrived AND parsed.
//
// ⚠️ TENANT-GENERIC ON PURPOSE. Nothing here names a company. The company is resolved FROM
// the job row, so the same code files a claim for the hundredth shop as for the first.
//
//   loadClaimContext({ jobId?, call?, companyId? })
//     -> { ok, source:'platform', company_id, platform_job_id,
//          job, customer, tdr, tdr_failures[], supplied[] }
//
// The job/customer/tdr/tdr_failures shapes deliberately MIRROR what the Xano endpoint
// returned, so a caller can swap sources without touching its own body.
'use strict';

const { getSecret } = require('./secrets');

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}

function rest(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) {
      const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(9000) });
      if (!r.ok) return null;
      return r.json().catch(() => null);
    },
  };
}

const S = (v) => (v == null ? '' : String(v));
const enc = encodeURIComponent;

// A UUID is the platform's job id; a run of digits is a warranty dispatch/call number.
function looksUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(S(v).trim()); }

// unit.attributes is a free-form jsonb the mirror fills from Xano's model/serial columns.
function attr(unit, ...keys) {
  const a = (unit && unit.attributes) || {};
  for (const k of keys) { const v = S(a[k]).trim(); if (v) return v; }
  return '';
}

// ── Cleaning the legacy parts junk ────────────────────────────────────────────
// The email parser stuffed the DESCRIPTION and the part number into one field:
//   "Main Control Board  Wh22x37840"   /   "THERMOSTAT HI LIMIT\nPart #WE04X30381"
// SquareTrade wants a clean PartNo and a real per-part description. Sending the mashed
// string as the part number, and the tech's whole narrative as every part's description,
// is what gets a claim kicked back. Same rule as the SQL part_key(): a literal "Part #X"
// wins; otherwise take the trailing token that contains a digit.
function cleanPartNo(raw) {
  const t = S(raw).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const tagged = t.match(/part\s*#\s*([A-Za-z0-9.\-]{5,})/i);
  if (tagged) return tagged[1].toUpperCase();
  const tail = t.match(/([A-Za-z0-9][A-Za-z0-9.\-]*[0-9][A-Za-z0-9.\-]*)[^A-Za-z0-9]*$/);
  if (tail && tail[1].replace(/[^A-Za-z0-9]/g, '').length >= 5) return tail[1].toUpperCase();
  return t.toUpperCase();
}
// The words, minus the part number -- "Main Control Board  Wh22x37840" -> "Main Control Board".
function cleanPartDesc(raw) {
  const t = S(raw).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const words = t.split(/part\s*#/i)[0]
    .split(' ')
    .filter((w) => w && !/\d/.test(w))          // drop any token carrying a digit
    .join(' ')
    .replace(/[^A-Za-z0-9 ()\/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return words;
}

// The claim's "returned" flag is the VENDOR'S OBLIGATION, not the tech's disposition.
// A core is owed back even when it was USED — keying this off disposition alone would drop
// the obligation the moment a tech marked the part used, which is exactly the chargeback
// SquareTrade writes into its own policy. So: owed back if the vendor said so, OR if the
// tech is sending it back.
function owedBack(p) {
  return (p.must_return === true || S(p.disposition) === 'return' || !!p.returned_at) ? 'Y' : 'N';
}

async function loadClaimContext(opts) {
  const o = opts || {};
  const { url, key } = await cfg();
  if (!url || !key) return { ok: false, error: 'platform not configured (PLATFORM_SUPABASE_URL / _SERVICE_KEY)' };
  const db = rest(url, key);

  const SEL = 'id,company_id,customer_id,unit_id,status,problem,claim_number,dispatch_id,warranty_company,'
    + 'parts_status,parts_eta,scheduled_start,started_at,completed_at,service_window,'
    + 'tdr_diagnosis,tdr_failed_component,tdr_part_number,tdr_repair_completed,tdr_labor_hours,xano_id';

  // ── resolve the job ───────────────────────────────────────────────────────────
  let job = null;
  const scope = o.companyId ? `&company_id=eq.${enc(o.companyId)}` : '';
  if (o.jobId && looksUuid(o.jobId)) {
    const rows = await db.get(`job?id=eq.${enc(S(o.jobId))}${scope}&select=${SEL}&limit=1`);
    job = (rows || [])[0] || null;
  }
  if (!job && o.jobId && /^\d+$/.test(S(o.jobId))) {
    // a numeric id is a XANO job id — the mirror keeps it on the platform row.
    const rows = await db.get(`job?xano_id=eq.${enc(S(o.jobId))}${scope}&select=${SEL}&limit=1`);
    job = (rows || [])[0] || null;
  }
  if (!job && o.call) {
    const c = S(o.call).trim();
    // A dispatch number can land in EITHER column depending on which lane created the job,
    // so try both rather than assuming the vendor always fills claim_number.
    let rows = await db.get(`job?claim_number=eq.${enc(c)}${scope}&select=${SEL}&order=created_at.desc&limit=1`);
    if (!rows || !rows.length) rows = await db.get(`job?dispatch_id=eq.${enc(c)}${scope}&select=${SEL}&order=created_at.desc&limit=1`);
    job = (rows || [])[0] || null;
  }
  if (!job) return { ok: false, error: 'no platform job for that id/call' };

  // ── the rest of the record ────────────────────────────────────────────────────
  const [custRows, unitRows, tdrRows, partRows] = await Promise.all([
    job.customer_id ? db.get(`customer?id=eq.${job.customer_id}&select=first_name,last_name,phone,email,address,city,state,zip`) : Promise.resolve([]),
    job.unit_id ? db.get(`unit?id=eq.${job.unit_id}&select=label,kind,attributes`) : Promise.resolve([]),
    db.get(`job_tdr?job_id=eq.${job.id}&select=root_cause,failed_component,part_number,notes,outcome,part_status,labor_hours,brand,model,tech,created_at&order=created_at.desc&limit=1`),
    db.get(`job_part?job_id=eq.${job.id}&select=number,name,disposition,must_return,order_status,cost_cents,sell_cents,source,ship_tracking,ship_carrier,ship_delivered,eta,returned_at,rma_number,return_tracking,bought_at,bought_from&order=created_at`),
  ]);

  const cust = (custRows || [])[0] || {};
  const unit = (unitRows || [])[0] || {};
  const t = (tdrRows || [])[0] || {};
  const parts = partRows || [];

  // ── shape to the contract the claim builder already speaks ────────────────────
  // Fall back job.tdr_* (the mirrored copy) whenever the live TDR row is blank, so a report
  // filed on the OLD system still files a claim on the new one.
  const tdr = {
    diagnosis: S(t.root_cause).trim() || S(job.tdr_diagnosis).trim() || S(t.failed_component).trim() || S(job.tdr_failed_component).trim(),
    failed_component: S(t.failed_component).trim() || S(job.tdr_failed_component).trim(),
    repair_completed: S(t.notes).trim() || S(job.tdr_repair_completed).trim(),
    part_number: S(t.part_number).trim() || S(job.tdr_part_number).trim(),
    labor_time_hours: (t.labor_hours != null ? t.labor_hours : job.tdr_labor_hours),
    model_number: S(t.model).trim() || attr(unit, 'model', 'model_number'),
    serial_number: attr(unit, 'serial', 'serial_number'),
    outcome: S(t.outcome),
    tech: S(t.tech),
  };

  const shaped = {
    id: job.id,
    claim_number: S(job.claim_number) || S(job.dispatch_id),
    notes_internal: '',                       // platform keeps the dispatch # in its own column
    problem_summary: S(job.problem),
    parts_status: S(job.parts_status),
    scheduling_status: S(job.status),
    brand: S(t.brand).trim() || attr(unit, 'brand'),
    model_number: tdr.model_number,
    serial_number: tdr.serial_number,
    appliance: S(unit.label) || S(unit.kind),
    purchase_date: null,                      // not mirrored; claim marks it still-needed
    job_started_at: job.started_at,
    job_completed_at: job.completed_at,
    scheduled_start: job.scheduled_start,
    authorization_number: '',
    service_contract_number: '',
    warranty_company: S(job.warranty_company),
  };

  // The parts the VENDOR shipped, in the shape the claim builder's `supplied` reader wants.
  // `checked` = a human has actually decided this part's fate. The vendor saying "must
  // return" is the OBLIGATION, not the decision — so an unopened part still reads unchecked
  // and correctly shows up on the claim's still-needed list.
  const supplied = parts
    .filter((p) => S(p.number) || S(p.name))
    .map((p) => ({
      part: cleanPartNo(S(p.number) || S(p.name)),
      description: cleanPartDesc(S(p.name) || S(p.number)),
      qty: 1,
      status: owedBack(p) === 'Y' ? (p.returned_at ? 'returned' : 'to_return') : (S(p.disposition) === 'not_here' ? 'missing' : 'used'),
      checked: !!(S(p.disposition) || p.returned_at),
      tracking: S(p.ship_tracking) || S(p.return_tracking),
      provider: S(p.ship_carrier),
      distributor: S(p.source),
      must_return: p.must_return === true,
      disposition: S(p.disposition),
      cost_cents: p.cost_cents,
      bought: !!p.bought_at,
    }));

  // tdr_failures: the claim's parts block. Prefer the real part rows; the platform keeps
  // one row per part, so this IS the list — no need to reconstruct it from TDR free text.
  const tdr_failures = parts
    .filter((p) => S(p.number) && S(p.disposition) !== 'not_here')
    .map((p) => {
      const no = cleanPartNo(p.number);
      // Deliberately NOT falling back to tdr.failed_component here. On a real job that
      // field holds the tech's whole narrative, so the fallback stamped the same paragraph
      // onto every part -- three parts, one identical description. Better to send the part
      // number alone than three copies of a paragraph.
      const desc = cleanPartDesc(S(p.name) || S(p.number)) || no;
      return { oem_part_number: no, part_number: no, quantity: 1, failed_component: desc, part_name: desc, our_cost_cents: p.cost_cents };
    });

  return {
    ok: true,
    source: 'platform',
    company_id: job.company_id,
    platform_job_id: job.id,
    xano_job_id: job.xano_id || null,
    job: shaped,
    customer: {
      first_name: S(cust.first_name), last_name: S(cust.last_name),
      address_line1: S(cust.address), address_line2: '',
      address: S(cust.address), city: S(cust.city), state: S(cust.state).toUpperCase(),
      zip: S(cust.zip), zip_code: S(cust.zip),
      phone: S(cust.phone), email: S(cust.email),
    },
    tdr,
    tdr_failures,
    supplied,
  };
}

module.exports = { loadClaimContext, owedBack };
