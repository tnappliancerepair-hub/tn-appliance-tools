#!/usr/bin/env node
// Round 5 — Scout Army Colony. 42 scout_<source>_<appliance> agents
// that build the model_intelligence corpus. Each scout enumerates
// known issues from its specific source × appliance pair when fired
// via SCOUT_REQUEST_<SOURCE>_<APPLIANCE>. Findings persist to
// model_intelligence table; queried by Ant Field Assist + diagnose_*
// agents during real jobs.
//
// 6 sources × 7 appliance categories = 42 scouts. Architect builds
// them overnight via the scout_specialist template (added 2026-06-04).

import fs from 'node:fs';

const BP_PATH = 'docs/appliance-ant-master-blueprint.json';
const bp = JSON.parse(fs.readFileSync(BP_PATH, 'utf8'));

const SOURCES = [
  { slug: 'ifixit',       display: 'iFixit',                    desc: 'crowd-sourced repair guides + teardown photos' },
  { slug: 'reddit',       display: 'Reddit r/appliancerepair',  desc: 'community wisdom + DIY confessions + pro responses' },
  { slug: 'applianceblog',display: 'ApplianceBlog Forums',      desc: 'tech-to-tech forum threads + model-specific fixes' },
  { slug: 'partspros',    display: 'AppliancePartsPros Tips',   desc: 'tech tips + part-substitution guides + DIY videos' },
  { slug: 'manualslib',   display: 'ManualsLib Service Docs',   desc: 'OEM service manuals + parts diagrams + tolerances' },
  { slug: 'repairclinic', display: 'RepairClinic Guides',       desc: 'symptom-to-cause troubleshooting trees' },
];

const APPLIANCES = ['washer', 'dryer', 'dishwasher', 'refrigerator', 'range', 'microwave', 'hvac'];

const SCOUT_AGENTS = [];
for (const src of SOURCES) {
  for (const app of APPLIANCES) {
    const trigger = `SCOUT_REQUEST_${src.slug.toUpperCase()}_${app.toUpperCase()}`;
    SCOUT_AGENTS.push({
      name: `scout_${src.slug}_${app}`,
      purpose: `Enumerates known ${app} issues from ${src.display} (${src.desc}). Persists findings to model_intelligence corpus for tech-side recall. Triggers on ${trigger}.`,
      triggers: [trigger],
      outputs: ['MODEL_INTELLIGENCE_FINDING', 'SCOUT_RUN_COMPLETE'],
      priority: 3,
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

// Find or create the Scout Army Colony
let colIdx = bp.colonies.findIndex((c) => c.name === 'Scout Army Colony');
if (colIdx < 0) {
  bp.colonies.push({
    name: 'Scout Army Colony',
    description: 'Web-scouring scout agents that build the model_intelligence corpus per (source × appliance) pair. The data moat — proprietary knowledge from every public source, queried by techs in the field.',
    agents: [],
    agents_total: 0,
    agents_live: 0,
  });
  colIdx = bp.colonies.length - 1;
  console.log(`Created new colony: Scout Army Colony at index ${colIdx}`);
}

const col = bp.colonies[colIdx];
if (!Array.isArray(col.agents)) col.agents = [];

const prefix = 'SC';
const pad = (n) => String(n).padStart(3, '0');
let nextNum = maxNumericSuffix(col.agents.map((a) => a.id), prefix);

const inserted = [];
for (const a of SCOUT_AGENTS) {
  // Skip if already exists by name
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
console.log(`[Scout Army Colony] +${inserted.length} agents: ${inserted[0]} → ${inserted[inserted.length - 1]}`);

bp.meta = bp.meta || {};
bp.meta.last_expanded_at = new Date().toISOString();
bp.meta.last_expansion = 'round-5-scout-army';
bp.meta.agents_total = bp.colonies.reduce((s, c) => s + (c.agents_total || (c.agents || []).length), 0);

fs.writeFileSync(BP_PATH, JSON.stringify(bp, null, 2));
console.log(`\nBlueprint updated. Total agents: ${bp.meta.agents_total}`);
console.log(`Scout Army Colony now has ${col.agents.length} TO_BUILD scout agents.`);
console.log(`\nNext: inject COLONY_ARCHITECT with max_builds=999.`);
