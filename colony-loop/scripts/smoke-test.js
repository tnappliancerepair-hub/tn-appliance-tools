import { config } from '../config.js';
import * as xano from '../xano.js';

const checks = [];

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  const tag = ok ? 'OK  ' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ` -- ${detail}` : ''}`);
}

async function run() {
  console.log(`colony-loop smoke test  (colony=${config.colonyName} dry_run=${config.dryRun})\n`);

  record('config.xanoIntakeBase set', !!config.xanoIntakeBase, config.xanoIntakeBase);
  record('config.ownerPhone set', !!config.ownerPhone, config.ownerPhone);
  record('config.anthropicApiKey set', !!config.anthropicApiKey, config.anthropicApiKey ? '(set)' : '(missing)');

  try {
    const sigs = await xano.fetchPendingSignals(1);
    record('xano.fetchPendingSignals reachable', true, `items=${sigs.length}`);
  } catch (err) {
    record('xano.fetchPendingSignals reachable', false, err.message);
  }

  try {
    const r = await xano.emitSignal({
      signal_type: 'SMOKE_TEST',
      signal_strength: 1,
      payload: { ts: Date.now(), note: 'smoke-test ping' },
    });
    record('xano.emitSignal works', !!r?.signal_id, `signal_id=${r?.signal_id}`);
    if (r?.signal_id) {
      const m = await xano.markSignalProcessed(r.signal_id, 'smoke_test_done', { note: 'smoke ok' });
      record('xano.markSignalProcessed works', !!m?.success, `signal_id=${r.signal_id}`);
    }
  } catch (err) {
    record('xano.emitSignal / markSignalProcessed', false, err.message);
  }

  try {
    const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
    const r = await xano.getDailyBriefingFiredToday(sinceMs);
    record('xano.getDailyBriefingFiredToday works', r?.success === true, `fired=${r?.fired}`);
  } catch (err) {
    record('xano.getDailyBriefingFiredToday works', false, err.message);
  }

  try {
    const r = await xano.getGreetingSentForJob(0);
    record('xano.getGreetingSentForJob works', r?.success === true, `sent=${r?.sent}`);
  } catch (err) {
    record('xano.getGreetingSentForJob works', false, err.message);
  }

  console.log();
  const fails = checks.filter((c) => !c.ok);
  if (fails.length) {
    console.log(`${fails.length} failure(s).`);
    process.exit(1);
  } else {
    console.log(`all ${checks.length} checks passed.`);
  }
}

run().catch((err) => {
  console.error('smoke-test crashed:', err);
  process.exit(1);
});
