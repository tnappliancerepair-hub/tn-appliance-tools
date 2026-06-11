// DEPLOY_XS — deploy XanoScript endpoints to Xano via the authenticated
// `xano` CLI on the Mac Mini, triggered by a colony signal.
//
// Why this exists: the cloud dev environment can't run `xano workspace push`
// (no CLI/auth there). The Mac Mini already has the authenticated CLI, so we
// route deploys through it: anywhere (incl. a cloud Claude session) emits a
// DEPLOY_XS signal → the loop here runs the push → reports back via SMS +
// event_log. Keeps the Xano token on this one trusted machine.
//
// Signal payload:
//   {
//     branch:    "claude/good-morning-TcydP",   // git branch holding the XS
//     endpoints: ["transition_job_state", ...], // endpoint names to push
//     dry_run:   false                          // optional: xano push --dry-run
//   }
//
// SAFETY:
//   - Only ever touches files under api/ (never colony-loop code or anything
//     else) — the git checkout pathspec is locked to "api/".
//   - Endpoint names are validated to [A-Za-z0-9_] only (no globs/traversal).
//   - Restores the working tree (git checkout HEAD -- api/) after pushing, so
//     the Mac Mini's own git pulls / the colony loop stay clean.
//   - Everything is logged + SMS'd to the owner.
//
// Config (optional env on the Mac Mini):
//   XANO_CLI_BIN     full path to xano if not on the launchd PATH (e.g.
//                    /opt/homebrew/bin/xano). Defaults to "xano".
//   DEPLOY_XS_BRANCH default branch if the signal omits one.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markSignalProcessed, logLocal } from '../xano.js';
import { toOwner } from '../sms.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../colony-loop/agents
const REPO_ROOT = join(HERE, '..', '..');             // repo root on the Mac Mini
const DEFAULT_BRANCH = process.env.DEPLOY_XS_BRANCH || 'claude/good-morning-TcydP';

// launchd starts the loop with a minimal PATH that does NOT include
// /opt/homebrew/bin, so a bare `xano` (installed via Homebrew/npm) isn't
// found and every push silently fails. Resolve the real binary at runtime:
// honor XANO_CLI_BIN, then ask a login shell (which sources the user's
// profile + full PATH), then fall back to the known install locations.
function resolveXanoBin() {
  if (process.env.XANO_CLI_BIN && existsSync(process.env.XANO_CLI_BIN)) {
    return process.env.XANO_CLI_BIN;
  }
  try {
    const found = execSync('/bin/zsh -lc "command -v xano"', {
      encoding: 'utf8', timeout: 15000,
    }).trim();
    if (found && existsSync(found)) return found;
  } catch (_) { /* fall through to known paths */ }
  const candidates = [
    '/opt/homebrew/bin/xano',
    '/usr/local/bin/xano',
    `${process.env.HOME || ''}/.npm-global/bin/xano`,
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return 'xano'; // last resort — will error visibly if truly absent
}

const XANO_BIN = resolveXanoBin();

function sh(cmd) {
  return execSync(cmd, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
  });
}

function validEndpoint(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(name);
}

export async function run(signal, ctx) {
  const p = signal.payload || {};
  const branch = (typeof p.branch === 'string' && /^[\w./-]{1,120}$/.test(p.branch)) ? p.branch : DEFAULT_BRANCH;
  const dryRun = p.dry_run === true;
  const endpoints = Array.isArray(p.endpoints) ? p.endpoints.filter(validEndpoint) : [];

  if (!endpoints.length) {
    logLocal('deploy_xs_skipped', { reason: 'no_valid_endpoints', branch });
    await markSignalProcessed(signal.id, 'deploy_xs_skipped', { reason: 'no_valid_endpoints', branch });
    return { success: false, action: 'no_valid_endpoints' };
  }

  let fetchErr = null;
  const results = [];

  try {
    sh(`git fetch origin ${branch}`);
    // Pull this branch's api/ XS into the working tree WITHOUT switching
    // branch — leaves colony-loop code (the running loop) untouched.
    sh(`git checkout origin/${branch} -- api/`);
  } catch (e) {
    fetchErr = String(e.message || e).slice(0, 500);
  }

  if (!fetchErr) {
    for (const ep of endpoints) {
      try {
        const flag = dryRun ? '--dry-run' : '--force';
        // Anchor the glob to api/ — the only tree we check out — so it never
        // collides with stale staging copies under colony-loop/xano-endpoints/
        // that may share a GUID (the danielle_schedule duplicate-GUID trap).
        const out = sh(`${XANO_BIN} workspace push -i "api/**/${ep}*" ${flag}`);
        results.push({ endpoint: ep, ok: true, out: String(out).slice(-300) });
      } catch (e) {
        results.push({ endpoint: ep, ok: false, err: String(e.message || e).slice(-300) });
      }
    }
    // Restore the working tree so the Mac Mini's own pulls stay clean.
    try { sh(`git checkout HEAD -- api/`); } catch (_) {}
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  const summary = fetchErr
    ? `git fetch/checkout failed: ${fetchErr}`
    : `pushed ${okCount}/${endpoints.length}${dryRun ? ' (dry-run)' : ''}${failCount ? `, ${failCount} FAILED` : ''}`;

  logLocal('deploy_xs_result', { branch, dryRun, results, fetchErr });
  await markSignalProcessed(signal.id, 'deploy_xs_result', {
    branch, ok: okCount, failed: failCount, dry_run: dryRun, summary,
  });

  try {
    const detail = results.map((r) => `${r.ok ? '✅' : '❌'}${r.endpoint}`).join(' ');
    await toOwner(`[ant deploy] ${summary}. ${detail}`.slice(0, 600), {
      source: 'deploy_xs', force_send: true, branch,
    });
  } catch (_) {}

  return { success: !fetchErr && failCount === 0, action: 'deploy_xs_result', summary };
}
