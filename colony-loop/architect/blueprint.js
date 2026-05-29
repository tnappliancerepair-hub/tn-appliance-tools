import { readFile, writeFile } from 'node:fs/promises';

export async function readBlueprint(path) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text);
}

export async function writeBlueprint(path, obj) {
  const text = JSON.stringify(obj, null, 2);
  await writeFile(path, text + '\n', 'utf8');
}

const PRIORITY_RANK = { HIGH: 1, MED: 2, MEDIUM: 2, LOW: 3 };

function statusDone(status) {
  const s = String(status || '').toUpperCase();
  return s === 'BUILT' || s === 'LIVE';
}

/**
 * Walk every colony's agents, return the highest-priority TO_BUILD agent
 * whose dependencies are all met. Returns {colony, agent} or null.
 *
 * Sort key: colony.priority (HIGH > MED > LOW) then agent.priority (int, lower = higher).
 *
 * @param {object} blueprint
 * @param {object} [opts]
 * @param {Set<string>} [opts.excludeIds] - agent ids to skip (e.g. tried-and-failed in this run)
 */
export function pickNextAgent(blueprint, opts = {}) {
  const excludeIds = opts.excludeIds || new Set();
  const colonies = blueprint.colonies || [];
  const statusMap = {};
  for (const c of colonies) {
    for (const a of c.agents || []) {
      statusMap[a.id] = a.status;
    }
  }

  const candidates = [];
  for (const colony of colonies) {
    for (const agent of colony.agents || []) {
      if (agent.status !== 'TO_BUILD') continue;
      if (excludeIds.has(agent.id)) continue;
      const deps = agent.dependencies || [];
      const unmet = deps.filter((d) => !statusDone(statusMap[d]));
      if (unmet.length > 0) continue;
      candidates.push({ colony, agent });
    }
  }

  // Capability-gap specs (#8 feedback loop): brains flagged ≥3 hits with
  // the same signature, the capability_gap_to_blueprint agent wrote
  // them into blueprint.capability_gap_specs as TO_BUILD. We treat
  // them like a synthetic colony with HIGH priority — they reflect
  // brains actively asking for the capability, so they outrank static
  // blueprint backlog.
  const gapSpecs = Array.isArray(blueprint.capability_gap_specs) ? blueprint.capability_gap_specs : [];
  for (const spec of gapSpecs) {
    if (spec.status !== 'TO_BUILD') continue;
    if (excludeIds.has(spec.id)) continue;
    candidates.push({
      colony: { id: 'CAPABILITY_GAPS', priority: 'HIGH', name: 'Capability Gaps (auto-injected)' },
      agent: {
        id: spec.id,
        name: `Capability gap: ${spec.signature}`,
        priority: 1,
        status: 'TO_BUILD',
        from_capability_gap: true,
        capability_gap_spec: spec,
      },
    });
  }

  candidates.sort((a, b) => {
    const pa = PRIORITY_RANK[String(a.colony.priority || 'MED').toUpperCase()] || 99;
    const pb = PRIORITY_RANK[String(b.colony.priority || 'MED').toUpperCase()] || 99;
    if (pa !== pb) return pa - pb;
    return (Number(a.agent.priority) || 99) - (Number(b.agent.priority) || 99);
  });

  return candidates[0] || null;
}

/**
 * Mutate blueprint in-place: mark <colonyId, agentId> as BUILT and bump
 * the relevant counters. Returns blueprint.
 */
export function markBuilt(blueprint, colonyId, agentId) {
  // Synthetic CAPABILITY_GAPS "colony" path — entries live in
  // blueprint.capability_gap_specs[] not blueprint.colonies[].
  if (colonyId === 'CAPABILITY_GAPS') {
    const specs = blueprint.capability_gap_specs || [];
    for (const spec of specs) {
      if (spec.id !== agentId) continue;
      spec.status = 'BUILT';
      spec.built_at_ms = Date.now();
      break;
    }
    return blueprint;
  }

  for (const c of blueprint.colonies || []) {
    if (c.id !== colonyId) continue;
    for (const a of c.agents || []) {
      if (a.id !== agentId) continue;
      a.status = 'BUILT';
      c.agents_live = Number(c.agents_live || 0) + 1;
      break;
    }
    break;
  }
  if (blueprint.meta) {
    blueprint.meta.agents_to_build = Math.max(0, Number(blueprint.meta.agents_to_build || 0) - 1);
    blueprint.meta.agents_live = Number(blueprint.meta.agents_live || 0) + 1;
  }
  return blueprint;
}
