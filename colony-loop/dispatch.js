import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(HERE, 'agents');

// Signal TTL — drops signals that have been unprocessable for longer
// than this many ms. Catches: deadline_ms typos that put signals 100
// years in the future, agents that were renamed and now no_agent_yet
// forever, lost dead-letter rows. Mark expired + skip dispatch.
//
// Override via env COLONY_SIGNAL_TTL_DAYS (default 14d).
const SIGNAL_TTL_MS = (() => {
  const days = parseInt(process.env.COLONY_SIGNAL_TTL_DAYS || '14', 10);
  return (Number.isFinite(days) && days > 0 ? days : 14) * 24 * 60 * 60 * 1000;
})();

const agentCache = new Map();

export async function dispatch(signal, ctx) {
  const type = (signal.signal_type || '').toLowerCase();
  if (!type) throw new Error('signal has no signal_type');

  // Hard TTL: if the signal was created more than N days ago and
  // we're still seeing it, something is wrong (typo'd deadline, lost
  // agent, dead-letter). Drop it loudly instead of churning forever.
  const createdAtMs = Number(signal.created_at || signal.created_at_ms || 0);
  if (createdAtMs && (Date.now() - createdAtMs) > SIGNAL_TTL_MS) {
    if (ctx && ctx.xano) {
      try {
        await ctx.xano.markSignalProcessed(signal.id, 'signal_ttl_expired', {
          signal_type: signal.signal_type,
          age_days: Math.round((Date.now() - createdAtMs) / 86400000),
        });
      } catch (_) {}
    }
    return { success: false, action: 'ttl_expired' };
  }

  let mod = agentCache.get(type);
  if (!mod) {
    const path = join(AGENTS_DIR, `${type}.js`);
    if (!existsSync(path)) {
      return { success: false, action: 'no_agent_yet' };
    }
    mod = await import(path);
    agentCache.set(type, mod);
  }

  if (typeof mod.run !== 'function') {
    throw new Error(`agent ${type} does not export run()`);
  }

  const payload = parsePayload(signal.payload);
  // Propagate trace_id from the signal payload into ctx so brain-core,
  // logCallAsync, and downstream emits all carry the same chain ID.
  const enrichedCtx = { ...ctx, trace_id: payload.trace_id || ctx.trace_id || '' };
  return mod.run({ ...signal, payload }, enrichedCtx);
}

function parsePayload(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); }
  catch { return { _raw: raw }; }
}
