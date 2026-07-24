'use strict';
// zone-integrity — the one place that knows which STATE each tech works. Derived
// from the live cluster_assignment coverage (every "TN *" cluster => TN, every
// "LA *" cluster => LA). This is the "set areas and states" truth Teddy pointed at:
// a Tennessee tech on a Louisiana job is simply wrong, and it's objective.
//
// Purpose (2026-07-24): stop Ann from ever CONFIDENTLY naming an out-of-zone tech.
// Assignments churn (a job briefly lands on the wrong tech before the office fixes
// it); during that window a customer calls and Ann parrots the wrong name — the
// exact trust-killer ("Jimmy is coming" for a Louisiana job). We validate the tech
// against the job's state and, when it doesn't match, say "your technician" instead.
//
// STATE-level only, on purpose — it's unambiguous and has near-zero false positives.
// Within a state, a tech may validly cover several clusters (e.g. Andre is a valid
// LA North tech at rank 2, John rank 1), so we do NOT second-guess same-state picks.
//
// Billy (5) is removed from the roster, so he's intentionally absent below — any job
// still sitting on him reads as out-of-zone, which is correct (he's gone).
const TECH_STATES = {
  1: ['TN'], // Teddy
  2: ['TN'], // Jimmy
  3: ['LA'], // Andre
  4: ['TN'], // Lee
  6: ['LA'], // John
};

// Does this tech work in the job's state? Permissive when we genuinely can't tell
// (no state on the job) so we never blank a real name without cause.
function techCoversState(technicianId, serviceState) {
  const tid = Number(technicianId) || 0;
  if (!tid) return false;                 // no tech assigned — nothing to name
  const st = String(serviceState || '').trim().toUpperCase();
  if (!st) return true;                   // unknown job state — don't second-guess
  const states = TECH_STATES[tid];
  if (!states) return false;              // unknown / removed tech — treat as out of zone
  return states.includes(st);
}

module.exports = { TECH_STATES, techCoversState };
