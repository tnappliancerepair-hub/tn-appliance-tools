import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(HERE, 'agents');

const agentCache = new Map();

export async function dispatch(signal, ctx) {
  const type = (signal.signal_type || '').toLowerCase();
  if (!type) throw new Error('signal has no signal_type');

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
  return mod.run({ ...signal, payload }, ctx);
}

function parsePayload(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); }
  catch { return { _raw: raw }; }
}
