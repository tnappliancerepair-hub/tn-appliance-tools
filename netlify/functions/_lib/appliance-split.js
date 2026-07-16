// appliance-split — detect a multi-appliance job (an AHS/warranty multi-item claim that
// landed as ONE job, e.g. "dryer/washer") and split the EXTRA appliances into their own
// linked sibling jobs. Each split job clones the tech + scheduled time + claim, so it
// automatically shows as its own stop on the tech's day AND gets its own TDR for warranty.
// Linking reuses the existing `stop_machine` markers (same as add-machine), so get-stop-machines
// groups them.
//
//   detectAppliances(text) -> { splittable, appliances:[canon...], combo, hadSeparator, raw }
//   splitJob(jobId, {live}) -> { ok, split, appliances, created:[{job_id,appliance}], plan, reason }
'use strict';
const crud = require('./xano/metadata-crud');

// Canonical appliances + their keywords. Order matters: first match wins per segment,
// and multi-word keywords ("washing machine") come before their single-word forms.
// NOTE order matters — "dishwasher" contains the substring "washer", so dishwasher MUST be
// checked before washer, or a dishwasher gets mis-mapped to washer.
const APPLIANCES = [
  { canon: 'refrigerator', kw: ['refrigerator', 'fridge'] },
  { canon: 'freezer', kw: ['freezer'] },
  { canon: 'dishwasher', kw: ['dish washer', 'dishwasher'] },
  { canon: 'washer', kw: ['washing machine', 'washer'] },
  { canon: 'dryer', kw: ['dryer'] },
  { canon: 'range', kw: ['range', 'stove', 'cooktop', 'wall oven', 'oven'] },
  { canon: 'microwave', kw: ['microwave'] },
  { canon: 'disposal', kw: ['garbage disposal', 'disposal'] },
];

// Real separators between two DISTINCT items. NOT "or" (uncertainty: "cooktop or range")
// and NOT "-" (used in "Washer-Dryer Combo" and "refrigerator - wine & wet bar").
const SEP = /\s*(?:\/|,|\+|&amp;|&|\band\b|\bplus\b)\s*/i;
// Single-unit signals — never split these.
const COMBO = /\bcombo\b|all[\s-]?in[\s-]?one|\b1\s*pc\b|one\s*piece|stackable/i;

function segToAppliance(seg) {
  const s = String(seg || '').toLowerCase();
  for (const a of APPLIANCES) for (const k of a.kw) if (s.includes(k)) return a.canon;
  return null;
}

// The core rule: split only when the label has a real separator, isn't a combo unit, and
// yields 2+ DISTINCT known appliances. A sentence that merely mentions two ("washer not a
// fridge") has no separator -> not split.
function detectAppliances(text) {
  const raw = String(text || '').trim();
  const combo = COMBO.test(raw);
  const hadSeparator = SEP.test(raw);
  let appliances = [];
  if (hadSeparator) {
    for (const seg of raw.split(SEP)) {
      const c = segToAppliance(seg);
      if (c && appliances.indexOf(c) < 0) appliances.push(c);
    }
  } else {
    const c = segToAppliance(raw);
    if (c) appliances = [c];
  }
  const splittable = hadSeparator && !combo && appliances.length >= 2;
  return { splittable, appliances, combo, hadSeparator, raw };
}

// Fields a split sibling INHERITS from the parent stop. Deliberately DROPS the per-appliance
// state (parts_status / parts_eta_date / office_stage) so the new machine starts clean but
// still lands on the same tech's day (technician_id + scheduled_start + scheduling_status).
const CLONE_KEYS = [
  'customer_id', 'bill_to_customer_id',
  'service_address', 'service_city', 'service_state', 'service_zip', 'zip',
  'technician_id', 'scheduled_start', 'scheduling_status', 'current_status',
  'warranty_company', 'claim_number', 'customer_type', 'dispatch_source_id',
  'customer_preference_text', 'access_notes', 'sms_consent', 'region', 'market',
];

const TERMINAL = ['completed', 'canceled', 'cancelled', 'no_fix_possible'];

// Split one job. dry (live=false) returns the plan without writing. live writes:
//  - relabels the parent's appliance_type to the FIRST appliance,
//  - creates a linked sibling job for each ADDITIONAL appliance (side-effect-free insert,
//    so NO customer greeting fires), linked via a `stop_machine` marker.
// Idempotent: skips appliances that already exist as a child of this stop.
async function splitJob(jobId, opts) {
  const live = !!(opts && opts.live);
  const id = parseInt(String(jobId).replace(/\D/g, ''), 10);
  if (!id) return { ok: false, error: 'job_id required' };

  let job;
  try { job = await crud.searchOne(crud.TABLES.jobs, { id }); }
  catch (e) { return { ok: false, error: 'read failed: ' + ((e && e.message) || e) }; }
  if (!job) return { ok: false, error: 'job not found', job_id: id };

  const det = detectAppliances(job.appliance_type || '');
  const status = String(job.scheduling_status || job.current_status || '').toLowerCase();
  if (!det.splittable) return { ok: true, job_id: id, split: false, appliances: det.appliances, raw: det.raw, reason: det.combo ? 'combo_unit' : (det.hadSeparator ? 'single_appliance' : 'no_separator') };
  if (TERMINAL.indexOf(status) >= 0) return { ok: true, job_id: id, split: false, appliances: det.appliances, reason: 'terminal_' + status };

  const [primary, ...extras] = det.appliances;

  // which appliances already exist as children of this stop (idempotency)
  let existingChildAppliances = [];
  try {
    const links = await crud.searchPage(crud.TABLES.event_log, { action: 'stop_machine' }, { id: 'desc' }, 400);
    existingChildAppliances = (links || [])
      .filter((r) => r && r.metadata && Number(r.metadata.stop_id) === id)
      .map((r) => String((r.metadata.appliance || '')).toLowerCase());
  } catch (_) { /* best-effort */ }

  const toCreate = extras.filter((a) => existingChildAppliances.indexOf(a) < 0);
  const plan = {
    parent_relabel: (String(job.appliance_type).toLowerCase() !== primary) ? { from: job.appliance_type, to: primary } : null,
    new_jobs: toCreate,
    already_present: extras.filter((a) => existingChildAppliances.indexOf(a) >= 0),
  };

  if (!live) return { ok: true, job_id: id, split: true, dry_run: true, appliances: det.appliances, status, plan };

  // LIVE: relabel parent to the primary appliance (so each stop shows one appliance)
  const created = [];
  try { if (plan.parent_relabel) await crud.update(crud.TABLES.jobs, id, { appliance_type: primary }); } catch (_) {}

  for (const appliance of toCreate) {
    const row = {};
    for (const k of CLONE_KEYS) if (job[k] !== undefined && job[k] !== null) row[k] = job[k];
    row.appliance_type = appliance;
    row.brand = '';
    row.model_number = '';
    const claim = String(job.claim_number || '').trim();
    row.problem_summary = (claim ? ('Claim ' + claim + ' — ') : '') + appliance + ' — additional item on this stop (auto-split from job #' + id + ')';
    row.channel = 'multi_appliance_split';
    let newId = null;
    try {
      const c = await crud.insert(crud.TABLES.jobs, row);
      newId = (c && (c.id || c.job_id)) || null;
    } catch (e) { created.push({ appliance, error: (e && e.message) || String(e) }); continue; }
    if (!newId) { created.push({ appliance, error: 'insert returned no id' }); continue; }
    try {
      await crud.logEvent('stop_machine', { stop_id: id, machine_job_id: newId, appliance, added_by: 'auto_split', at_ms: Date.now() });
    } catch (_) {}
    created.push({ job_id: newId, appliance });
  }

  try { await crud.logEvent('multi_appliance_split', { parent_job_id: id, appliances: det.appliances, created: created.map((c) => c.job_id).filter(Boolean), at_ms: Date.now() }); } catch (_) {}

  return { ok: true, job_id: id, split: true, appliances: det.appliances, primary, created };
}

module.exports = { detectAppliances, splitJob, APPLIANCES, TERMINAL };
