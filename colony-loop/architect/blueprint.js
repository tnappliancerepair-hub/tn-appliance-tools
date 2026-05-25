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
 */
export function pickNextAgent(blueprint) {
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
      const deps = agent.dependencies || [];
      const unmet = deps.filter((d) => !statusDone(statusMap[d]));
      if (unmet.length > 0) continue;
      candidates.push({ colony, agent });
    }
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
