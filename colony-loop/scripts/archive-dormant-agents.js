#!/usr/bin/env node
// archive-dormant-agents — move never-triggered ("dormant") colony agents into
// agents/archive/ so the live system is legible, then regenerate registry.js.
//
// SAFETY MODEL (why this won't archive a live agent):
//   An agent's trigger signal_type = FILENAME uppercased. We build a haystack of
//   every PRODUCER source (tick.js, all XS endpoints, netlify functions, and the
//   other agent files for chains) and KEEP any agent whose signal_type appears
//   as a quoted literal there — i.e. something actually emits it. We also KEEP a
//   few dynamic/chain families whose signals are built by template literals
//   (DIAGNOSE_${x}, BRAND_LOOKUP_${slug}) and so never appear as a quoted string,
//   plus parts_lookup_*/parts_* which are deferred for the pending Marcone/
//   Tribles APIs. registry.js is EXCLUDED from the haystack (it lists every key,
//   which would make everything look kept).
//
// DRY-RUN by default — prints keep/archive counts + the archive list. Pass
// --apply to actually move files and regenerate the registry.
//
//   node colony-loop/scripts/archive-dormant-agents.js            # preview
//   node colony-loop/scripts/archive-dormant-agents.js --apply    # do it
//
// After --apply on the Mac:  launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop

import { readdirSync, readFileSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const AGENTS_DIR = join(HERE, '..', 'agents');
const ARCHIVE_DIR = join(AGENTS_DIR, 'archive');
const APPLY = process.argv.includes('--apply');

// Families kept regardless: dynamic/template-literal signals that never appear
// as a quoted string (DIAGNOSE_${x}, PERFORMANCE_REQUEST_${scope}), plus parts_*
// which are deferred for the pending Marcone/Tribles APIs.
const KEEP_PREFIXES = ['diagnose_', 'brand_lookup_', 'parts_lookup_', 'parts_', 'sms_response_', 'scheduler_', 'performance_request_'];

function walk(dir, exts, out) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    let st; try { st = statSync(p); } catch (_) { continue; }
    if (st.isDirectory()) { if (f !== 'archive' && f !== 'node_modules' && !f.startsWith('.')) walk(p, exts, out); }
    else if (exts.some((e) => f.endsWith(e))) out.push(p);
  }
}

function buildHaystack() {
  const files = [];
  // producers: tick + lib + OTHER agents (chains), api XS, netlify functions
  walk(join(HERE, '..'), ['.js'], files);     // all of colony-loop/*.js (incl agents)
  walk(join(ROOT, 'api'), ['.xs'], files);
  walk(join(ROOT, 'netlify', 'functions'), ['.js'], files);
  let hay = '';
  for (const f of files) {
    if (f.endsWith('registry.js')) continue;          // lists every key — would falsely keep all
    if (f.endsWith('inject-signal.js')) continue;     // manual injection only
    try { hay += '\n' + readFileSync(f, 'utf8'); } catch (_) {}
  }
  return hay;
}

function signalType(file) { return file.replace(/\.js$/i, '').toUpperCase(); }
function emitted(hay, sig) { return hay.includes(`'${sig}'`) || hay.includes(`"${sig}"`); }

const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.js') && f !== 'registry.js');
const hay = buildHaystack();

const keep = [], archive = [];
for (const f of agentFiles) {
  const byPrefix = KEEP_PREFIXES.some((p) => f.startsWith(p));
  const byEmit = emitted(hay, signalType(f));
  if (byPrefix || byEmit) keep.push({ f, why: byEmit ? 'emitted' : 'keep-prefix' });
  else archive.push(f);
}

// Group archive by prefix for a readable preview
const byPrefix = {};
for (const f of archive) {
  const pfx = (f.match(/^([a-z]+_[a-z]+_?)/) || [, f])[1];
  byPrefix[pfx] = (byPrefix[pfx] || 0) + 1;
}

console.log(`\nColony agent archive ${APPLY ? '(APPLY)' : '(dry run — pass --apply to move)'}`);
console.log(`  total agents:   ${agentFiles.length}`);
console.log(`  KEEP:           ${keep.length}  (${keep.filter((k) => k.why === 'emitted').length} emitted, ${keep.filter((k) => k.why === 'keep-prefix').length} keep-prefix)`);
console.log(`  ARCHIVE:        ${archive.length}`);
console.log('\n  archive by prefix:');
for (const [p, n] of Object.entries(byPrefix).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${p}*`);

// Hard safety: never archive more than 80% of agents (catches a logic regression)
if (archive.length > agentFiles.length * 0.8) {
  console.error(`\nABORT: archive set (${archive.length}) > 80% of agents — that's suspicious, not running.`);
  process.exit(1);
}

if (!APPLY) {
  console.log('\nDry run only. Review the list above, then re-run with --apply.');
  console.log('Full archive list:', archive.join(' '));
  process.exit(0);
}

mkdirSync(ARCHIVE_DIR, { recursive: true });
for (const f of archive) renameSync(join(AGENTS_DIR, f), join(ARCHIVE_DIR, f));
console.log(`\nMoved ${archive.length} files to agents/archive/.`);

console.log('Regenerating registry...');
execSync('node ' + JSON.stringify(join(HERE, 'build-registry.js')), { stdio: 'inherit' });
console.log('\nDone. Now restart the loop:');
console.log('  launchctl kickstart -k gui/$UID/com.tnappliance.colony-loop');
