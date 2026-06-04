#!/usr/bin/env node
// Round 6 — Diagnostic Mode Scouts. Dedicated scout agents focused on
// enumerating diagnostic / service / test mode entry sequences per
// (brand × appliance) combination. These pour into the existing
// model_intelligence corpus with finding_type='diagnostic_mode_entry'.
//
// Brooke queries lookup_diagnostic_mode mid-call when a tech asks how
// to put an appliance into service mode. The richer this corpus, the
// faster every diagnostic gets.

import fs from 'node:fs';

const BP_PATH = 'docs/appliance-ant-master-blueprint.json';
const bp = JSON.parse(fs.readFileSync(BP_PATH, 'utf8'));

// 10 brands × 7 appliances = 70 diagnostic mode scouts
const BRANDS = ['whirlpool', 'lg', 'samsung', 'ge', 'maytag', 'kitchenaid', 'frigidaire', 'kenmore', 'bosch', 'electrolux'];
const APPLIANCES = ['washer', 'dryer', 'dishwasher', 'refrigerator', 'range', 'oven', 'microwave'];

const SCOUT_AGENTS = [];
for (const brand of BRANDS) {
  for (const app of APPLIANCES) {
    const trigger = `SCOUT_REQUEST_DIAGMODE_${brand.toUpperCase()}_${app.toUpperCase()}`;
    SCOUT_AGENTS.push({
      name: `scout_diagmode_${brand}_${app}`,
      purpose: `Enumerates diagnostic mode entry sequences, test cycles, error code references, and service mode procedures for ${brand} ${app}s. Source-agnostic — pulls from all relevant manuals, forums, bulletins, YouTube tutorials in training data. Persists findings to model_intelligence corpus with finding_type=diagnostic_mode_entry / diagnostic_mode_exit / test_cycle / error_code_reference. Triggers on ${trigger}.`,
      triggers: [trigger],
      outputs: ['MODEL_INTELLIGENCE_FINDING', 'SCOUT_RUN_COMPLETE'],
      priority: 2, // higher priority than generic source scouts
    });
  }
}

function maxNumericSuffix(ids, prefix) {
  let max = 0;
  for (const id of ids) {
    const m = String(id || '').match(new RegExp('^' + prefix + '(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

let colIdx = bp.colonies.findIndex((c) => c.name === 'Scout Army Colony');
if (colIdx < 0) throw new Error('Scout Army Colony not found — run expand-blueprint-5 first');

const col = bp.colonies[colIdx];
if (!Array.isArray(col.agents)) col.agents = [];

const prefix = 'SC';
const pad = (n) => String(n).padStart(3, '0');
let nextNum = maxNumericSuffix(col.agents.map((a) => a.id), prefix);

const inserted = [];
for (const a of SCOUT_AGENTS) {
  if (col.agents.some((existing) => existing.name === a.name)) continue;
  nextNum += 1;
  const id = `${prefix}${pad(nextNum)}`;
  col.agents.push({
    id,
    name: a.name,
    status: 'TO_BUILD',
    priority: a.priority,
    purpose: a.purpose,
    triggers: a.triggers,
    outputs: a.outputs,
    xano_endpoint: '',
    dependencies: [],
  });
  inserted.push(id);
}
col.agents_total = col.agents.length;
console.log(`[Scout Army Colony] +${inserted.length} diagnostic-mode scouts: ${inserted[0]} → ${inserted[inserted.length - 1]}`);

bp.meta = bp.meta || {};
bp.meta.last_expanded_at = new Date().toISOString();
bp.meta.last_expansion = 'round-6-diagnostic-mode-scouts';
bp.meta.agents_total = bp.colonies.reduce((s, c) => s + (c.agents_total || (c.agents || []).length), 0);

fs.writeFileSync(BP_PATH, JSON.stringify(bp, null, 2));
console.log(`\nBlueprint updated. Total agents: ${bp.meta.agents_total}`);
console.log(`Scout Army Colony now has ${col.agents.length} agents (incl. ${inserted.length} new diagnostic-mode).`);
