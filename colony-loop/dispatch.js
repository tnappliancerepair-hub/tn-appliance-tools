import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { AGENT_REGISTRY } from './agents/registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(HERE, 'agents');

// Startup validation: every registered agent must point to a file that
// exists. Fail loud if any are missing — that's the bug class the
// registry exists to catch. Skipping validation is a footgun, so it
// runs on first import and throws.
(function validateRegistry() {
  const missing = [];
  for (const [type, rel] of Object.entries(AGENT_REGISTRY)) {
    const path = join(AGENTS_DIR, rel.replace(/^\.\//, ''));
    if (!existsSync(path)) missing.push({ type, rel });
  }
  if (missing.length > 0) {
    const lines = missing.slice(0, 10).map((m) => `  ${m.type} → ${m.rel}`).join('\n');
    const extra = missing.length > 10 ? `\n  ... and ${missing.length - 10} more` : '';
    throw new Error(`Registry validation failed: ${missing.length} agents have missing files:\n${lines}${extra}\n\nRun: node scripts/build-registry.js`);
  }
})();

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

// Cache stores { mod, mtimeMs } per type so hot-reload can detect when
// an agent file changes on disk and re-import. Saves the
// launchctl-kickstart dance every time the architect builds.
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

  // Registry-based lookup (replaces filename derivation that historically
  // silently mis-fired when conventions drifted). signal_type lookup is
  // by UPPER_CASE key, so we normalize before look up.
  const signalKey = (signal.signal_type || '').toUpperCase();
  const registered = AGENT_REGISTRY[signalKey];
  if (!registered) {
    return { success: false, action: 'no_agent_yet' };
  }
  const path = join(AGENTS_DIR, registered.replace(/^\.\//, ''));
  if (!existsSync(path)) {
    // Should never hit this because startup validation prevents it,
    // but defense in depth.
    return { success: false, action: 'agent_file_missing' };
  }

  // Hot reload: re-import when the file mtime has changed since cache.
  // Saves the launchctl-kickstart restart dance after architect builds
  // or manual edits. Cost: 1 statSync per dispatch (negligible).
  let cached = agentCache.get(type);
  let currentMtime = 0;
  try { currentMtime = statSync(path).mtimeMs; } catch (_) {}
  let mod;
  if (cached && cached.mtimeMs === currentMtime) {
    mod = cached.mod;
  } else {
    // Cache-bust via query string — Node's import map ignores it but
    // a different specifier forces a fresh module evaluation.
    const url = `${path}?t=${currentMtime}`;
    mod = await import(url);
    agentCache.set(type, { mod, mtimeMs: currentMtime });
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
