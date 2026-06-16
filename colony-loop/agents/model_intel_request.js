// Handles MODEL_INTEL_REQUEST — pulls authoritative model intelligence (recalls,
// technical service bulletins, tech-sheet/manual links) from MSA World (and
// Whirlpool University when logged in) through the Mac-local daemon, then caches
// it to event_log so the cloud grounded-answer (ant-troubleshoot) can speak it.
//
//   cloud emits MODEL_INTEL_REQUEST {brand, model, appliance, request_id}
//   -> this agent (on the Mac) -> daemon /intel?source=msa -> recalls/bulletins
//   -> event_log 'model_intel_result' (brand+model+request_id keyed)
//   -> ant-troubleshoot reads it + leads the brief with any recall.
//
// IP-clean: on-demand, model-specific, for OUR service work. Never bulk-mirror.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT_FILE = join(__dirname, '../parts/.daemon-port');

async function resolveDaemonBase() {
  const tryPort = async (p) => {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch(`http://127.0.0.1:${p}/__version`, { signal: ctrl.signal });
      clearTimeout(t); return r.ok;
    } catch (_) { return false; }
  };
  try { const p = Number(String(readFileSync(PORT_FILE, 'utf8')).trim()); if (p && (await tryPort(p))) return `http://127.0.0.1:${p}`; } catch (_) {}
  const envP = Number(process.env.PARTS_PORT || 0); if (envP && (await tryPort(envP))) return `http://127.0.0.1:${envP}`;
  for (let p = 8787; p <= 8806; p++) { if (await tryPort(p)) return `http://127.0.0.1:${p}`; }
  return null;
}

async function intel(base, source, brand, model) {
  const url = `${base}/intel?source=${encodeURIComponent(source)}&brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}`;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 60000);
  try { const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(t); if (!r.ok) return { error: `daemon ${r.status}` }; return await r.json(); }
  catch (e) { clearTimeout(t); return { error: String((e && e.message) || e) }; }
}

export async function run(signal, ctx) {
  const { xano } = ctx;
  const payload = signal.payload || {};
  const requestId = String(payload.request_id || `mi_${Date.now()}`);
  const brand = String(payload.brand || '').trim();
  const model = String(payload.model || '').trim();
  const appliance = String(payload.appliance || '').trim();

  if (!brand && !model) {
    await xano.markSignalProcessed(signal.id, 'model_intel_request_handled', { outcome: 'skipped_no_model', request_id: requestId });
    return { success: false, action: 'skipped_no_model' };
  }

  const base = await resolveDaemonBase();
  if (!base) {
    await xano.recordEventLog('model_intel_result', {
      brand, model, appliance, request_id: requestId, ok: false, error: 'daemon_offline',
      recalls: [], bulletins: [], tech_sheets: [],
    });
    await xano.markSignalProcessed(signal.id, 'model_intel_request_handled', { outcome: 'daemon_offline', request_id: requestId });
    return { success: false, action: 'daemon_offline' };
  }

  // MSA is the anchor; also hit Whirlpool University when the appliance is a
  // Whirlpool-family brand (and that session is logged in — empty if not).
  const sources = ['msa'];
  if (/whirlpool|maytag|kitchenaid|amana|jenn/i.test(brand)) sources.push('whirlpool');

  const recalls = []; const bulletins = []; const techSheets = []; const errors = {};
  for (const s of sources) {
    const r = await intel(base, s, brand, model);
    if (r.error) { errors[s] = r.error; continue; }
    for (const x of (r.recalls || [])) recalls.push({ source: s, text: x });
    for (const x of (r.bulletins || [])) bulletins.push({ source: s, text: x });
    for (const x of (r.tech_sheets || [])) techSheets.push({ source: s, ...x });
  }

  const result = {
    brand, model, appliance, request_id: requestId, ok: true,
    recalls: recalls.slice(0, 12),
    bulletins: bulletins.slice(0, 12),
    tech_sheets: techSheets.slice(0, 12),
    sources, errors,
  };
  await xano.recordEventLog('model_intel_result', result);
  await xano.markSignalProcessed(signal.id, 'model_intel_request_handled', {
    outcome: 'ok', request_id: requestId, recalls: result.recalls.length, bulletins: result.bulletins.length,
  });
  return { success: true, action: 'model_intel_cached', request_id: requestId };
}
