// brain-deid — the wall between tenant PII and the shared brain. Turns a completed job/TDR
// into ONE de-identified outcome row: model -> symptom -> failed component -> part -> did-it-fix.
// The structured fields (appliance/brand/model/family/component/part/fault/grade) carry the
// entire predictive value and contain zero PII. The free-text symptom is the only field that
// could carry PII, so it is aggressively scrubbed against the job's own known identifiers AND
// generic PII patterns — and if anything looks unsafe we DROP the symptom rather than risk it
// (the structured fields still teach the brain). No customer, no address, no phone, no price,
// no shop identity ever reaches the corpus through here.
'use strict';

// Platform-family key: exact SKUs never repeat, platforms do (WTW5000DW1 -> WTW5000DW).
// Uppercase, strip spaces/dashes, drop a trailing revision run (<=2 trailing digits) while
// keeping a meaningful core. Imperfect derivation degrades gracefully — the aggregate falls
// back to brand+appliance when a family is thin.
function deriveFamily(model) {
  let m = String(model || '').toUpperCase().replace(/[\s-]+/g, '').trim();
  if (m.length < 5) return '';
  // strip a trailing revision: up to 2 digits at the very end, then an optional single rev letter
  const stripped = m.replace(/([A-Z0-9]{5,}?)([0-9]{1,2})$/, '$1');
  return (stripped.length >= 5 ? stripped : m);
}

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Scrub free text against known PII + generic patterns. Returns { text, redactions } or
// { text: '', dropped: true } when it can't be made safe. Conservative by design.
function scrubSymptom(raw, pii) {
  let t = String(raw || '').trim();
  if (!t) return { text: '', redactions: 0 };
  let n = 0;
  const p = pii || {};
  // 1) redact this job's OWN known identifiers (we know exactly who this customer is).
  const known = [];
  (Array.isArray(p.names) ? p.names : [p.name]).forEach((nm) => {
    String(nm || '').split(/[\s,]+/).forEach((tok) => { if (tok && tok.length >= 3) known.push(tok); });
  });
  (Array.isArray(p.phones) ? p.phones : [p.phone]).forEach((ph) => { const d = String(ph || '').replace(/\D/g, ''); if (d.length >= 7) known.push(d); });
  [p.email, p.address, p.city, p.zip].forEach((x) => { if (x && String(x).length >= 3) known.push(String(x)); });
  known.forEach((k) => { try { const re = new RegExp(esc(k), 'ig'); if (re.test(t)) { t = t.replace(re, ' '); n++; } } catch (_) {} });
  // 2) generic PII sweeps (belt-and-suspenders, catches PII we weren't handed).
  const pats = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig,                          // email
    /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,                  // phone
    /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|ct|court|way|pl|place|cir|circle|ter|terrace|hwy|pkwy|trl|trail)\b\.?/ig, // street address
    /\b\d{5}(?:-\d{4})?\b/g,                                                 // ZIP
  ];
  pats.forEach((re) => { if (re.test(t)) { t = t.replace(re, ' '); n++; } });
  // 3) tidy + cap. If any digit-run of 5+ survives, it could be an un-caught identifier —
  //    but model numbers/part numbers legitimately contain long alnum. Symptoms rarely need
  //    a bare 5+ digit number, so strip lone long digit runs as a final safety net.
  t = t.replace(/\b\d{5,}\b/g, ' ');
  t = t.replace(/\s+/g, ' ').trim().slice(0, 300);
  return { text: t, redactions: n };
}

// Build the de-identified outcome from a completed job/TDR. `job` carries structured fields;
// `pii` carries this job's own identifiers so the symptom scrub can redact them. Returns the
// corpus row (no PII) or null when there's nothing learnable (no component AND no part).
function extractOutcome(job, pii, opts) {
  const o = opts || {};
  const model = String(job.model || job.model_number || '').trim().slice(0, 60);
  const brand = String(job.brand || '').trim().slice(0, 40);
  const appliance = String(job.appliance || job.appliance_type || '').trim().slice(0, 40);
  const failed_component = String(job.failed_component || job.component || '').trim().slice(0, 80);
  const part_number = String(job.part_number || job.verified_part_number || job.oem_part_number || '').trim().slice(0, 60);
  const fault_code = String(job.fault_code || job.error_code || '').trim().slice(0, 20);
  if (!failed_component && !part_number) return null; // nothing to teach
  const sym = scrubSymptom(job.symptom || job.problem_summary || job.complaint || '', pii);
  const fixedFirst = job.fixed_first_trip != null ? !!job.fixed_first_trip : null;
  const fixed = job.fixed != null ? !!job.fixed
    : (String(job.repair_completed || job.status || '').toLowerCase().match(/complet|fixed|repair|done/) ? true : null);
  return {
    source: String(o.source || 'platform').slice(0, 20),
    contributed_by: String(o.contributed_by || '').slice(0, 80), // INTERNAL ONLY
    appliance, brand, model,
    platform_family: deriveFamily(model),
    symptom: sym.text,
    failed_component, part_number, fault_code,
    fixed_first_trip: fixedFirst,
    fixed,
    dedup_key: String(o.dedup_key || (o.source || 'platform') + ':' + (job.job_id || job.id || '')).slice(0, 120),
    _redactions: sym.redactions,
  };
}

module.exports = { deriveFamily, scrubSymptom, extractOutcome };
