// Handles PARTS_LOOKUP_REQUEST — the bridge between the cloud (Teddy Tool / cash
// Quick Check) and the Mac-local parts daemon (colony-loop/parts/serve.js).
//
// Flow:
//   cloud emits PARTS_LOOKUP_REQUEST {job_id, model, serial, component, request_id}
//   → this agent (runs on the Mac, same box as the daemon)
//   → calls the LIVE daemon /lookup for Marcone (OEM cost) + Amazon (aftermarket)
//   → narrows to the failed component, picks the best candidate per tier
//   → records event_log 'parts_lookup_result' (job_id + request_id keyed)
//   → Teddy Tool polls get-parts-lookup.js and auto-fills the 4-option fields.
//
// We do NOT write the tdr_failure row here — Teddy reviews + confirms in the tool
// (he has final say), and the existing create_tdr persists it. This keeps the
// human in the loop and needs zero new XanoScript.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT_FILE = join(__dirname, '../parts/.daemon-port');

// Resolve the daemon base URL. serve.js writes its actual (auto-hopped) port to
// .daemon-port; fall back to PARTS_PORT env, then probe the common range.
async function resolveDaemonBase() {
  const tryPort = async (p) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch(`http://127.0.0.1:${p}/__version`, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return true;
    } catch (_) {}
    return false;
  };
  // 1) the port file the daemon publishes
  try {
    const p = Number(String(readFileSync(PORT_FILE, 'utf8')).trim());
    if (p && (await tryPort(p))) return `http://127.0.0.1:${p}`;
  } catch (_) {}
  // 2) env override
  const envP = Number(process.env.PARTS_PORT || 0);
  if (envP && (await tryPort(envP))) return `http://127.0.0.1:${envP}`;
  // 3) probe the auto-port range (8787..8806)
  for (let p = 8787; p <= 8806; p++) { if (await tryPort(p)) return `http://127.0.0.1:${p}`; }
  return null;
}

async function daemonLookup(base, supplier, query) {
  const url = `${base}/lookup?supplier=${encodeURIComponent(supplier)}&model=${encodeURIComponent(query)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { error: `daemon ${r.status}`, candidates: [] };
    return await r.json();
  } catch (e) {
    clearTimeout(t);
    return { error: String((e && e.message) || e), candidates: [] };
  }
}

// "$154.46" / "$1,234.56" → integer cents. Empty/garbage → null.
function priceToCents(s) {
  if (!s) return null;
  const m = String(s).replace(/[, ]/g, '').match(/\$?(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * 100);
}

// Pick the candidate whose name best matches the failed-component words.
// No component → first candidate (suppliers return relevance order).
function pickBest(candidates, component) {
  const list = Array.isArray(candidates) ? candidates.filter((c) => c && c.part_number) : [];
  if (!list.length) return null;
  const words = String(component || '').toLowerCase().match(/[a-z]{3,}/g) || [];
  if (!words.length) return list[0];
  let best = null, bestScore = -1;
  for (const c of list) {
    const hay = `${c.name || ''} ${c.part_number || ''}`.toLowerCase();
    let score = 0;
    for (const w of words) { if (hay.includes(w)) score += 1; }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore > 0 ? best : list[0];
}

export async function run(signal, ctx) {
  const { xano } = ctx;
  const payload = signal.payload || {};
  const jobId = Number(payload.job_id) || null;
  const requestId = String(payload.request_id || `req_${Date.now()}`);
  const model = String(payload.model || '').trim();
  const serial = String(payload.serial || '').trim();
  const component = String(payload.component || payload.failure_description || '').trim();

  if (!model && !serial) {
    await xano.markSignalProcessed(signal.id, 'parts_lookup_request_handled', {
      outcome: 'skipped_no_model', job_id: jobId, request_id: requestId,
    });
    return { success: false, action: 'skipped_no_model' };
  }

  const base = await resolveDaemonBase();
  if (!base) {
    // Daemon not running / not reachable. Record so the tool can show a clear
    // "parts daemon offline — start it on the Mac" message instead of spinning.
    await xano.recordEventLog('parts_lookup_result', {
      job_id: jobId, request_id: requestId, model, serial, component,
      ok: false, error: 'daemon_offline',
      message: 'Parts daemon not reachable on localhost. On the Mac: cd colony-loop/parts && node serve.js (then log into Marcone + Amazon).',
    });
    await xano.markSignalProcessed(signal.id, 'parts_lookup_request_handled', {
      outcome: 'daemon_offline', job_id: jobId, request_id: requestId,
    });
    return { success: false, action: 'daemon_offline' };
  }

  // Marcone = OEM cost (search by model; narrow client-side by component).
  // Amazon = aftermarket (include the component in the search to focus results).
  const marconeQ = serial && /samsung/i.test(component) ? serial : model;
  const amazonQ = [model, component].filter(Boolean).join(' ');
  const [marcone, amazon] = await Promise.all([
    daemonLookup(base, 'marcone', marconeQ || model || serial),
    daemonLookup(base, 'amazon', amazonQ || model || serial),
  ]);

  const oemPick = pickBest(marcone.candidates, component);
  const amzPick = pickBest(amazon.candidates, component);

  const result = {
    job_id: jobId,
    request_id: requestId,
    model, serial, component,
    ok: true,
    daemon_base: base,
    oem: oemPick ? {
      part_number: oemPick.part_number,
      name: oemPick.name || '',
      our_cost_cents: priceToCents(oemPick.price),
      brand: oemPick.brand || '',
      stock: oemPick.stock || '',
      source: 'marcone',
    } : null,
    amazon: amzPick ? {
      part_number: amzPick.part_number,
      name: amzPick.name || '',
      our_cost_cents: priceToCents(amzPick.price),
      url: amzPick.url || '',
      source: 'amazon',
    } : null,
    // keep a few alternates so the tool can offer a dropdown
    marcone_candidates: (marcone.candidates || []).slice(0, 8),
    amazon_candidates: (amazon.candidates || []).slice(0, 6),
    marcone_error: marcone.error || null,
    amazon_error: amazon.error || null,
  };

  await xano.recordEventLog('parts_lookup_result', result);
  await xano.markSignalProcessed(signal.id, 'parts_lookup_request_handled', {
    outcome: 'ok', job_id: jobId, request_id: requestId,
    oem_part: result.oem ? result.oem.part_number : null,
    amazon_part: result.amazon ? result.amazon.part_number : null,
  });
  return { success: true, action: 'parts_lookup_result_recorded', request_id: requestId };
}
