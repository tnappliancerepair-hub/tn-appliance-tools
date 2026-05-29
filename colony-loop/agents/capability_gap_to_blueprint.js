// CAPABILITY-GAP → BLUEPRINT FEEDBACK LOOP
//
// Daily 5:30am CT — reads the last 14 days of brain_capability_gap
// events, normalizes + groups by gap_description signature, and when
// any signature has N≥3 hits writes a CAPABILITY_GAP_SPEC entry into
// docs/appliance-ant-master-blueprint.json so the next architect run
// includes it as TO_BUILD.
//
// Closes the loop: brains complain about missing capabilities → the
// architect auto-builds an agent to fill the gap on the next 6am run.
// Doesn't replace human review — Teddy still sees the Sunday digest
// and can edit the blueprint — but small/obvious gaps stop sitting
// in the queue waiting for him to triage.
//
// Threshold: 3 hits with the same normalized signature in the 14d
// window. Lower would generate noise; higher misses real signal.

import fs from 'node:fs/promises';
import path from 'node:path';
import { listRecentEventLog } from '../xano.js';

const BLUEPRINT_PATH = path.join(process.cwd(), 'docs', 'appliance-ant-master-blueprint.json');
const HITS_THRESHOLD = 3;
const WINDOW_DAYS = 14;

export async function run(signal, ctx) {
  const { xano, log } = ctx;

  let gaps = [];
  try {
    gaps = await listRecentEventLog({ action: 'brain_capability_gap', days_back: WINDOW_DAYS, limit: 1000 });
  } catch (e) {
    await xano.markSignalProcessed(signal.id, 'capability_gap_to_blueprint_handled', { reason: 'query_failed', error: String(e) });
    return { success: false, action: 'query_failed' };
  }

  if (!gaps || gaps.length === 0) {
    await xano.markSignalProcessed(signal.id, 'capability_gap_to_blueprint_handled', { reason: 'no_gaps' });
    return { success: true, action: 'no_gaps' };
  }

  // Group by normalized signature
  const buckets = new Map();
  for (const row of gaps) {
    let meta;
    try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; }
    catch (_) { continue; }
    if (!meta) continue;
    const desc = String(meta.gap_description || '').trim();
    if (!desc) continue;
    const sig = normalize(desc);
    if (!sig) continue;
    if (!buckets.has(sig)) {
      buckets.set(sig, {
        signature: sig,
        first_seen_at: meta.flagged_at_ms || row.created_at_ms || Date.now(),
        last_seen_at: meta.flagged_at_ms || row.created_at_ms || Date.now(),
        descriptions: [],
        brains: new Set(),
        proposed_solutions: [],
        hit_count: 0,
      });
    }
    const b = buckets.get(sig);
    b.hit_count += 1;
    b.descriptions.push(desc.slice(0, 200));
    if (meta.brain) b.brains.add(String(meta.brain));
    if (meta.proposed_solution) b.proposed_solutions.push(String(meta.proposed_solution).slice(0, 200));
    if (meta.flagged_at_ms && meta.flagged_at_ms > b.last_seen_at) b.last_seen_at = meta.flagged_at_ms;
    if (meta.flagged_at_ms && meta.flagged_at_ms < b.first_seen_at) b.first_seen_at = meta.flagged_at_ms;
  }

  const candidates = Array.from(buckets.values()).filter((b) => b.hit_count >= HITS_THRESHOLD);

  if (candidates.length === 0) {
    await xano.markSignalProcessed(signal.id, 'capability_gap_to_blueprint_handled', {
      reason: 'no_threshold_hits',
      gaps_seen: gaps.length,
      buckets: buckets.size,
    });
    return { success: true, action: 'no_threshold_hits' };
  }

  // Read blueprint
  let blueprint = null;
  try {
    const raw = await fs.readFile(BLUEPRINT_PATH, 'utf8');
    blueprint = JSON.parse(raw);
  } catch (e) {
    await xano.markSignalProcessed(signal.id, 'capability_gap_to_blueprint_handled', {
      reason: 'blueprint_read_failed',
      error: String(e),
      candidates: candidates.length,
    });
    return { success: false, action: 'blueprint_read_failed' };
  }

  // Ensure capability_gap_specs section exists
  if (!Array.isArray(blueprint.capability_gap_specs)) blueprint.capability_gap_specs = [];
  const existingSigs = new Set(blueprint.capability_gap_specs.map((s) => s.signature));

  let added = 0;
  for (const c of candidates) {
    if (existingSigs.has(c.signature)) continue;
    blueprint.capability_gap_specs.push({
      id: `CGS-${c.signature.slice(0, 24)}-${Date.now().toString(36)}`,
      signature: c.signature,
      status: 'TO_BUILD',
      hit_count: c.hit_count,
      brains: Array.from(c.brains),
      first_seen_at_ms: c.first_seen_at,
      last_seen_at_ms: c.last_seen_at,
      sample_descriptions: c.descriptions.slice(0, 3),
      sample_proposed_solutions: c.proposed_solutions.slice(0, 3),
      injected_by: 'capability_gap_to_blueprint',
      injected_at_ms: Date.now(),
    });
    added += 1;
  }

  if (added === 0) {
    await xano.markSignalProcessed(signal.id, 'capability_gap_to_blueprint_handled', {
      reason: 'all_already_present',
      candidates: candidates.length,
    });
    return { success: true, action: 'all_already_present' };
  }

  // Write back
  try {
    await fs.writeFile(BLUEPRINT_PATH, JSON.stringify(blueprint, null, 2) + '\n');
  } catch (e) {
    await xano.markSignalProcessed(signal.id, 'capability_gap_to_blueprint_handled', {
      reason: 'blueprint_write_failed',
      error: String(e),
      added,
    });
    return { success: false, action: 'blueprint_write_failed' };
  }

  await xano.markSignalProcessed(signal.id, 'capability_gap_to_blueprint_handled', {
    candidates: candidates.length,
    added,
    total_specs_now: blueprint.capability_gap_specs.length,
  });
  log('capability_gap_to_blueprint_injected', { added });
  return { success: true, action: 'injected', count: added };
}

// Normalize gap descriptions to a comparable signature. Lowercase,
// strip common filler, take the most distinctive 4-8 tokens.
function normalize(text) {
  const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'for', 'in', 'on', 'at', 'and', 'or', 'but', 'is', 'are', 'we', 'us', 'our', 'i', 'need', 'want', 'should', 'could', 'would', 'can', 'cannot', 'not', 'do', 'does', 'done', 'have', 'has', 'had', 'be', 'been', 'this', 'that', 'these', 'those', 'with', 'from', 'up', 'so']);
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t.length > 2 && !STOP.has(t));
  // Take the first 6 distinctive tokens, sorted alphabetically for
  // signature stability ("look up Marcone part stock" + "Marcone part
  // stock lookup" → same signature).
  const distinctive = Array.from(new Set(tokens)).slice(0, 6).sort();
  return distinctive.join('_');
}
