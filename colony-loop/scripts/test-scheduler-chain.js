#!/usr/bin/env node
// End-to-end synthetic test for the scheduler chain.
//
// Creates a synthetic parallel-mode job via create_job_from_email, then
// watches event_log + scheduling_queue + broadcast_attempt for the
// expected chain of events. Reports per-step pass/fail with timing.
//
// USAGE:
//   node test-scheduler-chain.js                 # Test A — bogus zip, owner-alert-only path
//   node test-scheduler-chain.js --zip 37013     # Test B — real cluster (broadcasts to TN Metro techs)
//   node test-scheduler-chain.js --cleanup       # Delete the test job + queue row + customer after
//   node test-scheduler-chain.js --no-create     # Skip POST; replay watcher against most-recent test job
//   node test-scheduler-chain.js --verbose       # Show every event_log row inspected
//
// SAFE BY DEFAULT:
//   * Customer phone: +15555550001 (fake — gated by CUSTOMER_FACING_ENABLED=false)
//   * Default zip 00000: no cluster match → broadcast handler escalates to owner only
//   * Use --zip 37013 ONLY after texting Jimmy + Lee "test broadcast in next 30 min, ignore"
//
// ENV (from colony-loop/.env):
//   XANO_INTAKE_BASE     (required) — e.g. https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA
//   XANO_METADATA_TOKEN  (required) — JWT for Metadata API
//
// EXIT CODES:
//   0 — all expected steps passed
//   1 — one or more steps failed or timed out
//   2 — env config missing
//   3 — initial POST to create_job_from_email failed
//
// CHAIN OBSERVED:
//   STEP 1: event_log "parallel_job_created_from_email" with job_id    [≤5s]
//   STEP 2: event_log "parallel_job_auto_enqueued" with job_id         [≤5s] (REQUIRES Tier 1 paste)
//   STEP 3: scheduling_queue row exists, action_type=broadcast         [≤5s]
//   STEP 4: scheduling_queue row picked up (status → processing)        [≤90s]
//   STEP 5: scheduling_queue row finalized (status → completed/failed)  [≤120s]
//   STEP 6: Outcome — broadcast_attempt created OR escalation logged    [≤120s]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const FLAGS = parseFlags();
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function parseFlags() {
  const args = process.argv.slice(2);
  const flags = {
    zip: '00000',
    cleanup: false,
    noCreate: false,
    verbose: false,
    pollSeconds: 120,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--zip') flags.zip = args[++i];
    else if (a === '--cleanup') flags.cleanup = true;
    else if (a === '--no-create') flags.noCreate = true;
    else if (a === '--verbose') flags.verbose = true;
    else if (a === '--poll-seconds') flags.pollSeconds = parseInt(args[++i], 10);
  }
  return flags;
}

async function loadEnv() {
  try {
    const raw = await fs.readFile(path.join(REPO_ROOT, 'colony-loop/.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env optional — token may come from credentials.yaml fallback
  }

  // Fallback: pull metadata token from ~/.xano/credentials.yaml if env didn't have it
  if (!process.env.XANO_METADATA_TOKEN) {
    try {
      const home = process.env.HOME;
      const raw = await fs.readFile(path.join(home, '.xano/credentials.yaml'), 'utf8');
      const m = raw.match(/access_token:\s*([^\s\n]+)/);
      if (m) process.env.XANO_METADATA_TOKEN = m[1].replace(/^["']|["']$/g, '');
    } catch {}
  }
}

const INTAKE_BASE = process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';

const TABLES = {
  scheduling_queue: 25,
  broadcast_attempt: 23,
  event_log: 3,
  jobs: 7,
  customer: 5,  // best-effort; may differ
};

function fmtMs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function log(msg) {
  console.log(msg);
}

function logStep(num, label, status, detail = '') {
  const symbol = status === 'pass' ? `${ANSI.green}✓${ANSI.reset}` :
                 status === 'fail' ? `${ANSI.red}✗${ANSI.reset}` :
                 status === 'skip' ? `${ANSI.yellow}~${ANSI.reset}` :
                 `${ANSI.cyan}…${ANSI.reset}`;
  const detailColored = status === 'fail' ? `${ANSI.red}${detail}${ANSI.reset}` :
                        status === 'pass' ? `${ANSI.green}${detail}${ANSI.reset}` :
                        `${ANSI.gray}${detail}${ANSI.reset}`;
  log(`  ${symbol} STEP ${num}: ${label} ${detail ? '— ' + detailColored : ''}`);
}

async function api(method, url, body = null, isAuth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (isAuth) headers['Authorization'] = `Bearer ${process.env.XANO_METADATA_TOKEN}`;
  const init = { method, headers };
  if (body) init.body = JSON.stringify(body);
  const r = await fetch(url, init);
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!r.ok) throw new Error(`${method} ${url} → HTTP ${r.status}: ${typeof parsed === 'string' ? parsed.slice(0, 200) : JSON.stringify(parsed).slice(0, 200)}`);
  return parsed;
}

async function getMetaLastPage(tableId, perPage = 2000) {
  const d = await api('GET', `${META_BASE}/table/${tableId}/content?page=1&per_page=${perPage}`, null, true);
  return d.pageTotal || 1;
}

async function getMetaItems(tableId, page, perPage = 2000) {
  const d = await api('GET', `${META_BASE}/table/${tableId}/content?page=${page}&per_page=${perPage}`, null, true);
  return d.items || [];
}

async function findEventLogAfter(action, afterMs, jobId = null, maxWaitSeconds = 5) {
  const start = Date.now();
  while (Date.now() - start < maxWaitSeconds * 1000) {
    const lastPage = await getMetaLastPage(TABLES.event_log);
    const items = await getMetaItems(TABLES.event_log, lastPage);
    const hits = items.filter(r => r.action === action && (r.created_at || 0) >= afterMs);
    const matched = jobId ? hits.find(r => {
      const m = r.metadata;
      if (typeof m === 'string') return m.includes(`"job_id":${jobId}`) || m.includes(`'job_id': ${jobId}`);
      if (m && typeof m === 'object') return m.job_id === jobId || String(m.job_id) === String(jobId);
      return false;
    }) : (hits[0] || null);
    if (matched) return { row: matched, waitedMs: Date.now() - start };
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

async function findSchedulingQueueRow(jobId, maxWaitSeconds = 5) {
  const start = Date.now();
  while (Date.now() - start < maxWaitSeconds * 1000) {
    const lastPage = await getMetaLastPage(TABLES.scheduling_queue, 100);
    const items = await getMetaItems(TABLES.scheduling_queue, lastPage, 100);
    const row = items.find(r => r.job_id === jobId);
    if (row) return { row, waitedMs: Date.now() - start };
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

async function waitForQueueStatus(queueRowId, targetStatuses, maxWaitSeconds) {
  const start = Date.now();
  let lastStatus = null;
  while (Date.now() - start < maxWaitSeconds * 1000) {
    try {
      const row = await api('GET', `${META_BASE}/table/${TABLES.scheduling_queue}/content/${queueRowId}`, null, true);
      lastStatus = row.status;
      if (targetStatuses.includes(row.status)) {
        return { row, waitedMs: Date.now() - start };
      }
    } catch (e) {
      if (FLAGS.verbose) log(`    ${ANSI.dim}poll err: ${e.message}${ANSI.reset}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return { row: null, waitedMs: Date.now() - start, lastStatus };
}

async function findBroadcastAttempt(jobId, sinceMs, maxWaitSeconds = 60) {
  const start = Date.now();
  while (Date.now() - start < maxWaitSeconds * 1000) {
    const lastPage = await getMetaLastPage(TABLES.broadcast_attempt, 50);
    const items = await getMetaItems(TABLES.broadcast_attempt, lastPage, 50);
    const row = items.find(r => r.job_id === jobId && (r.created_at || 0) >= sinceMs);
    if (row) return { row, waitedMs: Date.now() - start };
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

async function createSyntheticJob() {
  const ts = Date.now();
  const payload = {
    intake_source: 'manual',
    received_at_ms: ts,
    customer_first_name: 'TestRunner',
    customer_last_name: `DryRun-${ts}`,
    customer_phone: '+15555550001',
    customer_email: '',
    service_address: '1 Test St',
    service_city: 'Antioch',
    service_state: 'TN',
    service_zip: FLAGS.zip,
    appliance_type: 'refrigerator',
    brand: 'TestBrand',
    model_number: 'TM-TEST',
    problem_summary: '[TEST RUN] Synthetic — ignore',
    warranty_company: 'TestVendor',
    claim_number: `TEST-${ts}`,
    dispatch_number: '',
    dry_run: false,
  };
  log(`${ANSI.dim}    POST ${INTAKE_BASE}/create_job_from_email${ANSI.reset}`);
  log(`${ANSI.dim}    payload: claim=${payload.claim_number} zip=${payload.service_zip}${ANSI.reset}`);
  const resp = await api('POST', `${INTAKE_BASE}/create_job_from_email`, payload);
  return { resp, postedAtMs: ts };
}

async function cleanup(jobId, queueRowId, customerId) {
  log(`\n${ANSI.bold}Cleanup:${ANSI.reset}`);
  const ops = [];
  if (queueRowId) {
    try {
      await api('DELETE', `${META_BASE}/table/${TABLES.scheduling_queue}/content/${queueRowId}`, null, true);
      ops.push(`✓ scheduling_queue id=${queueRowId}`);
    } catch (e) { ops.push(`✗ scheduling_queue id=${queueRowId}: ${e.message}`); }
  }
  if (jobId) {
    try {
      await api('DELETE', `${META_BASE}/table/${TABLES.jobs}/content/${jobId}`, null, true);
      ops.push(`✓ jobs id=${jobId}`);
    } catch (e) { ops.push(`✗ jobs id=${jobId}: ${e.message}`); }
  }
  if (customerId) {
    try {
      await api('DELETE', `${META_BASE}/table/${TABLES.customer}/content/${customerId}`, null, true);
      ops.push(`✓ customer id=${customerId}`);
    } catch (e) { ops.push(`✗ customer id=${customerId}: ${e.message}`); }
  }
  ops.forEach(op => log(`  ${op}`));
}

async function main() {
  log(`${ANSI.bold}${ANSI.cyan}═══ SCHEDULER CHAIN END-TO-END TEST ═══${ANSI.reset}`);
  log(`${ANSI.dim}flags: zip=${FLAGS.zip} cleanup=${FLAGS.cleanup} noCreate=${FLAGS.noCreate} verbose=${FLAGS.verbose}${ANSI.reset}\n`);

  await loadEnv();
  if (!process.env.XANO_METADATA_TOKEN) {
    log(`${ANSI.red}ERROR: XANO_METADATA_TOKEN missing. Set in colony-loop/.env or ~/.xano/credentials.yaml${ANSI.reset}`);
    process.exit(2);
  }

  const results = { step1: null, step2: null, step3: null, step4: null, step5: null, step6: null };
  let jobId = null, customerId = null, queueRowId = null, postedAtMs = null;

  // ─────────────────────────────────────────────────────────────
  // POST to create_job_from_email (or skip if --no-create)
  // ─────────────────────────────────────────────────────────────
  if (FLAGS.noCreate) {
    log(`${ANSI.yellow}--no-create flag set, skipping POST. Replay mode not implemented yet.${ANSI.reset}`);
    process.exit(1);
  }

  log(`${ANSI.bold}POST create_job_from_email${ANSI.reset}`);
  let postResult;
  try {
    postResult = await createSyntheticJob();
    postedAtMs = postResult.postedAtMs;
    jobId = postResult.resp.job_id;
    customerId = postResult.resp.customer_id;
    if (!jobId) {
      log(`${ANSI.red}✗ POST returned no job_id. Response:${ANSI.reset}`);
      log(JSON.stringify(postResult.resp, null, 2));
      process.exit(3);
    }
    log(`  ${ANSI.green}✓${ANSI.reset} job_id=${jobId} customer_id=${customerId} intake_source=${postResult.resp.intake_source}`);
  } catch (e) {
    log(`${ANSI.red}✗ POST failed: ${e.message}${ANSI.reset}`);
    process.exit(3);
  }

  log(`\n${ANSI.bold}Watching chain (timeout ${FLAGS.pollSeconds}s)...${ANSI.reset}`);

  // ─────────────────────────────────────────────────────────────
  // STEP 1: event_log "parallel_job_created_from_email"
  // ─────────────────────────────────────────────────────────────
  logStep(1, 'parallel_job_created_from_email', 'pending');
  const s1 = await findEventLogAfter('parallel_job_created_from_email', postedAtMs - 5000, jobId, 5);
  if (s1) {
    results.step1 = s1;
    logStep(1, 'parallel_job_created_from_email', 'pass', `found in ${fmtMs(s1.waitedMs)}, event_log id=${s1.row.id}`);
  } else {
    logStep(1, 'parallel_job_created_from_email', 'fail', 'NOT FOUND within 5s — endpoint or audit log broken');
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 2: event_log "parallel_job_auto_enqueued" (REQUIRES Tier 1 paste)
  // ─────────────────────────────────────────────────────────────
  logStep(2, 'parallel_job_auto_enqueued', 'pending');
  const s2 = await findEventLogAfter('parallel_job_auto_enqueued', postedAtMs - 5000, jobId, 5);
  if (s2) {
    results.step2 = s2;
    logStep(2, 'parallel_job_auto_enqueued', 'pass', `found in ${fmtMs(s2.waitedMs)}, queue_id=${s2.row.metadata?.queue_id || '?'}`);
  } else {
    logStep(2, 'parallel_job_auto_enqueued', 'fail', 'NOT FOUND — Tier 1 paste likely missing (scheduler-1-create_job_from_email.txt)');
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 3: scheduling_queue row exists for this job
  // ─────────────────────────────────────────────────────────────
  logStep(3, 'scheduling_queue row created', 'pending');
  const s3 = await findSchedulingQueueRow(jobId, 5);
  if (s3) {
    results.step3 = s3;
    queueRowId = s3.row.id;
    logStep(3, 'scheduling_queue row created', 'pass', `id=${queueRowId} action_type=${s3.row.action_type} status=${s3.row.status}`);
  } else {
    logStep(3, 'scheduling_queue row created', 'fail', 'no row found');
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 4: Worker picks up the row (status → processing)
  // ─────────────────────────────────────────────────────────────
  if (queueRowId) {
    logStep(4, 'worker pickup (pending→processing/completed)', 'pending');
    const s4 = await waitForQueueStatus(queueRowId, ['processing', 'completed', 'failed'], 90);
    if (s4.row) {
      results.step4 = s4;
      logStep(4, 'worker pickup', 'pass', `status=${s4.row.status} in ${fmtMs(s4.waitedMs)}`);
    } else {
      logStep(4, 'worker pickup', 'fail', `still 'pending' after 90s, last seen='${s4.lastStatus}'. SCHEDULING_QUEUE_ENABLED=false?`);
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 5: Final status (completed or failed)
    // ─────────────────────────────────────────────────────────────
    logStep(5, 'queue row finalized (completed/failed)', 'pending');
    const s5 = await waitForQueueStatus(queueRowId, ['completed', 'failed'], 120);
    if (s5.row) {
      results.step5 = s5;
      const color = s5.row.status === 'completed' ? 'pass' : 'fail';
      logStep(5, 'queue row finalized', color, `status=${s5.row.status} notes='${(s5.row.result_notes || '').slice(0, 100)}'`);
    } else {
      logStep(5, 'queue row finalized', 'fail', `STUCK at status='${s5.lastStatus}' after 120s — null-job hardening footgun?`);
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 6: Outcome — broadcast_attempt OR escalation
    // ─────────────────────────────────────────────────────────────
    logStep(6, 'outcome (broadcast_attempt or escalation)', 'pending');
    const broadcast = await findBroadcastAttempt(jobId, postedAtMs - 5000, 5);
    if (broadcast) {
      results.step6 = broadcast;
      logStep(6, 'outcome: broadcast_attempt created', 'pass', `id=${broadcast.row.id} type=${broadcast.row.broadcast_type} status=${broadcast.row.status}`);
    } else if (results.step5?.row?.result_notes?.includes('cluster')) {
      logStep(6, 'outcome: cluster-not-found escalation', 'pass', `result_notes confirmed no-cluster path: '${results.step5.row.result_notes.slice(0, 80)}'`);
    } else {
      logStep(6, 'outcome', 'fail', 'no broadcast_attempt found and no clear escalation path');
    }
  } else {
    logStep(4, 'worker pickup', 'skip', 'no queue row to watch');
    logStep(5, 'queue row finalized', 'skip', 'no queue row to watch');
    logStep(6, 'outcome', 'skip', 'no queue row to watch');
  }

  // ─────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────
  log(`\n${ANSI.bold}═══ RESULTS ═══${ANSI.reset}`);
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  const allPass = passed === total;
  log(`  ${allPass ? ANSI.green : ANSI.red}${passed}/${total} steps passed${ANSI.reset}`);
  log(`  job_id=${jobId} customer_id=${customerId} queue_id=${queueRowId || 'n/a'}`);

  if (FLAGS.cleanup) {
    await cleanup(jobId, queueRowId, customerId);
  } else {
    log(`\n${ANSI.dim}    Test artifacts left in place. Re-run with --cleanup to remove.${ANSI.reset}`);
  }

  process.exit(allPass ? 0 : 1);
}

// Guard: only run main() when invoked as a CLI script, NOT when imported.
// Without this guard, a syntax-check `import()` or test-harness load would
// fire a real POST to create_job_from_email. Reproduced 2026-05-31.
const isInvokedAsCli = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isInvokedAsCli) {
  main().catch(e => {
    log(`${ANSI.red}FATAL: ${e.message}${ANSI.reset}`);
    console.error(e);
    process.exit(1);
  });
}

export { main, createSyntheticJob, cleanup };
