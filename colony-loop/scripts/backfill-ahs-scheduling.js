#!/usr/bin/env node
// HOUR 1 backfill: drain the AHS not_ready backlog into scheduling_queue.
//
// Pages through list_ahs_backlog, and for each job:
//   1. Loads auto-schedule context (which exposes pending_propose_count).
//   2. If a propose row already exists pending — skip.
//   3. Else — enqueue a scheduling_queue propose row via the existing endpoint.
//
// Writes a run summary to docs/ahs-backfill-log.json so re-runs (e.g. after a
// crash) can be reasoned about without redoing accidental enqueues.
//
// Flags:
//   --dry-run        only report what would be enqueued (no writes)
//   --max=N          stop after N enqueues (default: unbounded)
//   --per-page=N     pagination size (default: 200)
//   --require-pref   only enqueue rows whose customer_preference_text is non-empty

import * as xano from '../xano.js';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const dryRun = Boolean(args['dry-run']);
const maxEnqueue = args['max'] ? Number(args['max']) : Infinity;
const perPage = args['per-page'] ? Number(args['per-page']) : 200;
const requirePref = Boolean(args['require-pref']);

const summary = {
  started_at: new Date().toISOString(),
  finished_at: null,
  dry_run: dryRun,
  max_enqueue: maxEnqueue === Infinity ? null : maxEnqueue,
  per_page: perPage,
  require_pref: requirePref,
  pages_fetched: 0,
  jobs_examined: 0,
  jobs_enqueued: 0,
  jobs_skipped_already_pending: 0,
  jobs_skipped_no_preference: 0,
  jobs_failed: 0,
  errors: [],
  enqueued_ids: [],
};

async function main() {
  console.log(`[ahs-backfill] start (dry_run=${dryRun}, per_page=${perPage}, max=${maxEnqueue === Infinity ? 'unbounded' : maxEnqueue}, require_pref=${requirePref})`);

  let page = 1;
  while (summary.jobs_enqueued < maxEnqueue) {
    let res;
    try {
      res = await xano.listAhsBacklog(page, perPage);
    } catch (err) {
      summary.errors.push({ phase: 'list', page, error: String(err.message || err) });
      console.error(`[ahs-backfill] list page ${page} failed:`, err.message || err);
      break;
    }
    summary.pages_fetched += 1;
    const jobs = (res && res.jobs) || [];
    if (jobs.length === 0) {
      console.log(`[ahs-backfill] page ${page} returned 0 jobs - end of backlog`);
      break;
    }
    console.log(`[ahs-backfill] page ${page}: ${jobs.length} jobs`);

    for (const j of jobs) {
      if (summary.jobs_enqueued >= maxEnqueue) break;
      summary.jobs_examined += 1;

      if (requirePref) {
        const pref = String(j.customer_preference_text || '').trim();
        if (!pref) {
          summary.jobs_skipped_no_preference += 1;
          continue;
        }
      }

      let ctx;
      try {
        ctx = await xano.getAutoScheduleContext(j.id);
      } catch (err) {
        summary.jobs_failed += 1;
        summary.errors.push({ phase: 'ctx', job_id: j.id, error: String(err.message || err) });
        continue;
      }
      const pendingCount = Number((ctx && ctx.pending_propose_count) || 0);
      if (pendingCount > 0) {
        summary.jobs_skipped_already_pending += 1;
        continue;
      }

      if (dryRun) {
        summary.enqueued_ids.push(j.id);
        summary.jobs_enqueued += 1;
        continue;
      }

      try {
        const r = await xano.enqueueSchedulingQueuePropose(j.id, 'ahs_backfill', 1);
        if (r && r.success) {
          summary.enqueued_ids.push(j.id);
          summary.jobs_enqueued += 1;
        } else {
          summary.jobs_failed += 1;
          summary.errors.push({ phase: 'enqueue', job_id: j.id, response: r });
        }
      } catch (err) {
        summary.jobs_failed += 1;
        summary.errors.push({ phase: 'enqueue', job_id: j.id, error: String(err.message || err) });
      }

      if (summary.jobs_enqueued % 50 === 0 && summary.jobs_enqueued > 0) {
        console.log(`[ahs-backfill] progress: ${summary.jobs_enqueued} enqueued`);
      }
    }

    if (jobs.length < perPage) break;
    page += 1;
  }

  summary.finished_at = new Date().toISOString();

  const outDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../docs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'ahs-backfill-log.json');
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));

  console.log('[ahs-backfill] done.');
  console.log(`  examined=${summary.jobs_examined}`);
  console.log(`  enqueued=${summary.jobs_enqueued}`);
  console.log(`  skipped_already_pending=${summary.jobs_skipped_already_pending}`);
  console.log(`  skipped_no_preference=${summary.jobs_skipped_no_preference}`);
  console.log(`  failed=${summary.jobs_failed}`);
  console.log(`  log=${outFile}`);
}

await main();
