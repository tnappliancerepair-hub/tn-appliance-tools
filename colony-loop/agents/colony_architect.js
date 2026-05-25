import { config } from '../config.js';
import {
  readBlueprint,
  writeBlueprint,
  pickNextAgent,
  markBuilt,
} from '../architect/blueprint.js';
import { generateAgent } from '../architect/templates.js';
import { promisify } from 'node:util';
import { exec as execCb } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const exec = promisify(execCb);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const AGENTS_DIR = join(REPO_ROOT, 'colony-loop/agents');
const BLUEPRINT_PATH = join(REPO_ROOT, 'docs/appliance-ant-master-blueprint.json');

const MAX_BUILDS_HARD_CAP = 10;

// launchd-spawned processes get a minimal PATH that excludes /opt/homebrew/bin.
// Inject the homebrew + standard system paths so `node` and `git` resolve.
// Also use the running Node's own absolute path for the --check call as a
// belt-and-suspenders fallback.
const RICH_PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`;
const EXEC_ENV = { ...process.env, PATH: RICH_PATH };
const EXEC_OPTS = { env: EXEC_ENV };

async function nodeSyntaxCheck(filePath) {
  await exec(`"${process.execPath}" --check "${filePath}"`, EXEC_OPTS);
}

async function gitCommitAndPush({ commitMsg, files }) {
  const addArgs = files.map((f) => `"${f}"`).join(' ');
  await exec(`git -C "${REPO_ROOT}" add ${addArgs}`, EXEC_OPTS);
  const safeMsg = commitMsg.replace(/"/g, '\\"');
  await exec(`git -C "${REPO_ROOT}" commit -m "${safeMsg}"`, EXEC_OPTS);
  const { stdout } = await exec(`git -C "${REPO_ROOT}" rev-parse HEAD`, EXEC_OPTS);
  const sha = stdout.trim().slice(0, 7);
  await exec(`git -C "${REPO_ROOT}" push`, EXEC_OPTS);
  return sha;
}

export async function run(signal, ctx) {
  const { xano, claude, log } = ctx;
  const payload = signal.payload || {};
  const maxBuilds = Math.min(
    MAX_BUILDS_HARD_CAP,
    Math.max(1, Number(payload.max_builds) || 1),
  );

  const results = [];

  for (let i = 0; i < maxBuilds; i++) {
    let bp;
    try {
      bp = await readBlueprint(BLUEPRINT_PATH);
    } catch (err) {
      log('colony_architect_blueprint_read_failed', { error: err.message });
      results.push({ outcome: 'blueprint_read_failed', error: err.message });
      break;
    }

    const next = pickNextAgent(bp);
    if (!next) {
      results.push({ outcome: 'nothing_to_build' });
      log('colony_architect_nothing_to_build', { iteration: i });
      break;
    }

    const { colony, agent } = next;
    log('colony_architect_picked', {
      iteration: i,
      agent_id: agent.id,
      agent_name: agent.name,
      colony_id: colony.id,
      colony_name: colony.name,
    });

    let generated;
    try {
      generated = await generateAgent(agent, claude, config);
    } catch (err) {
      log('colony_architect_generation_failed', {
        agent_id: agent.id,
        error: err.message,
      });
      results.push({
        outcome: 'generation_failed',
        agent_id: agent.id,
        error: err.message,
      });
      continue;
    }

    if (!generated || !generated.code || !generated.filename) {
      log('colony_architect_no_template', {
        agent_id: agent.id,
        triggers: agent.triggers,
        outputs: agent.outputs,
      });
      results.push({ outcome: 'no_template', agent_id: agent.id });
      continue;
    }

    const agentPath = join(AGENTS_DIR, generated.filename);

    try {
      await writeFile(agentPath, generated.code, 'utf8');
    } catch (err) {
      log('colony_architect_write_failed', {
        agent_id: agent.id,
        file: generated.filename,
        error: err.message,
      });
      results.push({
        outcome: 'write_failed',
        agent_id: agent.id,
        error: err.message,
      });
      continue;
    }

    // node --check gate — refuse to commit a syntactically broken file.
    try {
      await nodeSyntaxCheck(agentPath);
    } catch (err) {
      // Roll back the bad file
      try {
        await unlink(agentPath);
      } catch (_) {}
      log('colony_architect_syntax_failed', {
        agent_id: agent.id,
        file: generated.filename,
        error: String(err.message || err).slice(0, 400),
      });
      results.push({
        outcome: 'syntax_failed',
        agent_id: agent.id,
        error: String(err.message || err).slice(0, 400),
      });
      continue;
    }

    // Update blueprint in-memory and on disk
    markBuilt(bp, colony.id, agent.id);
    try {
      await writeBlueprint(BLUEPRINT_PATH, bp);
    } catch (err) {
      log('colony_architect_blueprint_write_failed', {
        agent_id: agent.id,
        error: err.message,
      });
      results.push({
        outcome: 'blueprint_write_failed',
        agent_id: agent.id,
        error: err.message,
      });
      continue;
    }

    // Commit + push
    let commitSha = '';
    try {
      commitSha = await gitCommitAndPush({
        commitMsg: `feat(colony): [architect] built ${agent.id} ${agent.name}`,
        files: [agentPath, BLUEPRINT_PATH],
      });
    } catch (err) {
      log('colony_architect_git_failed', {
        agent_id: agent.id,
        error: String(err.message || err).slice(0, 400),
      });
      results.push({
        outcome: 'git_failed',
        agent_id: agent.id,
        error: String(err.message || err).slice(0, 400),
      });
      continue;
    }

    log('colony_architect_built', {
      agent_id: agent.id,
      agent_name: agent.name,
      colony_id: colony.id,
      file: generated.filename,
      signal_type: generated.signal_type,
      commit_sha: commitSha,
      chars: generated.code.length,
    });

    results.push({
      outcome: 'built',
      agent_id: agent.id,
      agent_name: agent.name,
      colony_id: colony.id,
      file: generated.filename,
      signal_type: generated.signal_type,
      commit_sha: commitSha,
    });
  }

  const built = results.filter((r) => r.outcome === 'built').length;
  const failed = results.filter((r) =>
    ['generation_failed', 'write_failed', 'syntax_failed', 'blueprint_write_failed', 'git_failed'].includes(r.outcome),
  ).length;

  await xano.markSignalProcessed(signal.id, 'colony_architect_fired', {
    builds_attempted: results.length,
    builds_succeeded: built,
    builds_failed: failed,
    results,
  });

  log('colony_architect_summary', {
    built,
    failed,
    attempted: results.length,
  });

  return {
    success: true,
    action: 'colony_architect_fired',
    built,
    failed,
    attempted: results.length,
  };
}
