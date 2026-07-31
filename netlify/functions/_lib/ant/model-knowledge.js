// model-knowledge — the ANCHOR of the Knowledge Engine: model-specific recall.
// "On THIS exact model (or its platform family), here is what actually fails and
// the part that fixes it." (Teddy 2026-07-31: model-specific recall is the #1
// capability the brain must nail.)
//
// Reliability by design — this is the most important read in the business, so it
// must NEVER hiccup:
//   • Pure logic on the read path. It does NO network of its own; the caller feeds
//     it the structured TDR entries it already fetched (get_common_failures). If
//     that fetch failed, it still answers from the bundled base.
//   • Model-FAMILY matching. A WTW5000DW1 query learns from every WTW5000DW* job
//     we've closed — exact SKUs almost never repeat, platforms do. This is why the
//     old exact-match returned 0 on a real model.
//   • A bundled base (model-knowledge.json), distilled from the 49k-job archive +
//     the trade's known failure patterns, covers models we haven't serviced yet.
//   • Every source is optional and merged; any one being empty degrades to the
//     others. It returns {} rather than throwing — the brain's hot path is sacred.
//
// The three tiers, best-first: exact model > platform family > brand+appliance base.
'use strict';

let BASE = {};
try { BASE = require('./model-knowledge.json') || {}; } catch (_) { BASE = {}; }
const BASE_MODELS = BASE.models || {};

// Normalize a model to a comparable key: uppercase, strip non-alphanumerics.
function normModel(m) { return String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

// The platform family: the same machine across revisions. Whirlpool-family models
// carry a trailing REVISION digit (WTW5000DW1, WTW5000DW2, MHW5500FW0) — strip ONE
// trailing digit only when it follows a letter, so WTW5000DW1 -> WTW5000DW but a
// model ending in letters (LG LMXS28626S, Samsung RF28R7351SG — trailing letters
// are color/variant, share failures) is left exact. Conservative on purpose.
function familyOf(m) {
  const n = normModel(m);
  return n.replace(/([A-Z])\d{1,2}$/, '$1');
}

// A looser platform prefix for breadth when neither exact nor family hit: the
// alphanumeric stem (first ~7 chars) groups a maker's platform line.
function platformOf(m) { return normModel(m).slice(0, 7); }

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Collapse many TDR rows for one model into ranked, deduped failures. Each failure
// carries the most-seen non-empty verified part + how many jobs back it.
function aggregate(rows) {
  const byComp = {};
  for (const r of rows) {
    const comp = norm(r.failed_component || r.component);
    if (!comp) continue;
    const g = byComp[comp] || (byComp[comp] = { component: r.failed_component || r.component, count: 0, parts: {}, jobs: [], causes: {} });
    g.count++;
    const part = String(r.verified_part_number || r.part || '').trim();
    if (part) g.parts[part] = (g.parts[part] || 0) + 1;
    const cause = String(r.failure_cause || r.cause || '').trim();
    if (cause) g.causes[cause] = (g.causes[cause] || 0) + 1;
    if (r.job_id && g.jobs.length < 6) g.jobs.push(r.job_id);
  }
  return Object.values(byComp)
    .map((g) => ({
      component: g.component,
      part: Object.entries(g.parts).sort((a, b) => b[1] - a[1])[0] ? Object.entries(g.parts).sort((a, b) => b[1] - a[1])[0][0] : '',
      cause: Object.entries(g.causes).sort((a, b) => b[1] - a[1])[0] ? Object.entries(g.causes).sort((a, b) => b[1] - a[1])[0][0] : '',
      count: g.count,
      jobs: g.jobs,
    }))
    .sort((a, b) => b.count - a.count);
}

// recall({ brand, appliance, model, entries }) -> model-specific recall.
//   entries: the rows the caller already pulled from get_common_failures
//            ([{ model_number, failed_component, verified_part_number, failure_cause, job_id }]).
// Returns { matched_on, model, family, failures:[{component,part,cause,count,jobs}], seen_n, sources }.
function recall(opts) {
  const o = opts || {};
  const model = o.model || '';
  const entries = Array.isArray(o.entries) ? o.entries : [];
  const nm = normModel(model), fam = familyOf(model), plat = platformOf(model);
  const sources = [];
  let rows = [], matched_on = null;

  if (nm) {
    // Tier 1: exact model.
    const exact = entries.filter((e) => normModel(e.model_number || e.model) === nm && nm.length >= 4);
    if (exact.length) { rows = exact; matched_on = 'model'; }
    // Tier 2: platform family.
    if (!rows.length && fam.length >= 5) {
      const family = entries.filter((e) => familyOf(e.model_number || e.model) === fam);
      if (family.length) { rows = family; matched_on = 'family'; }
    }
    // Tier 3: platform prefix (looser breadth).
    if (!rows.length && plat.length >= 6) {
      const pf = entries.filter((e) => normModel(e.model_number || e.model).slice(0, 7) === plat);
      if (pf.length) { rows = pf; matched_on = 'platform'; }
    }
  }

  let failures = aggregate(rows);
  if (failures.length) sources.push('tdr');

  // Merge the bundled base for this model/family (breadth for models we haven't
  // serviced ourselves). Base rows never override a real TDR failure of the same
  // component — they add coverage, tagged so the brain knows they're trade-pattern
  // rather than our-own-job evidence.
  const baseKey = (nm && BASE_MODELS[nm]) ? nm : (BASE_MODELS[fam] ? fam : null);
  let baseSymptoms = [], baseSeen = 0;
  if (baseKey) {
    const known = new Set(failures.map((f) => norm(f.component)));
    for (const bf of (BASE_MODELS[baseKey].failures || [])) {
      if (known.has(norm(bf.component))) continue;
      failures.push({ component: bf.component, part: bf.part || '', cause: bf.cause || '', count: bf.count || 0, jobs: [], base: true });
    }
    baseSymptoms = BASE_MODELS[baseKey].symptoms || [];
    baseSeen = BASE_MODELS[baseKey].seen_n || 0;
    if (!matched_on) matched_on = 'base';
    sources.push('base');
  }

  failures = failures.slice(0, 6);
  const seen_n = rows.length + baseSeen;
  // hasSignal: a model is "known" if we have ranked failures OR real archive breadth
  // (we've been out to this model N times with common complaints) even absent a part.
  const known = failures.length || (baseSeen && baseSymptoms.length);
  return { matched_on: known ? matched_on : null, model, family: fam, failures, base_symptoms: baseSymptoms, base_seen: baseSeen, seen_n, sources };
}

// Coverage for the scorecard: how many distinct models/families the bundled base
// knows (breadth the brain carries even before we service a machine).
function baseCoverage() {
  return { models: Object.keys(BASE_MODELS).length, distilled_from: BASE.distilled_from || 0, updated: BASE.updated || null };
}

module.exports = { recall, aggregate, familyOf, normModel, platformOf, baseCoverage, BASE_MODELS };
