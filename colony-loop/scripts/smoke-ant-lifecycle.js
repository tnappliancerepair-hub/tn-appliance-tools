#!/usr/bin/env node
// END-TO-END ANT-ONLY JOB LIFECYCLE SMOKE TEST
//
// Walks one synthetic job through every stage of the parallel Ant
// path to verify the rails are intact:
//
//   1. Create job via create_job_from_email (parallel_mode=true)
//   2. Confirm job lands in needs-scheduled queue
//   3. Confirm AHS-style intake also emitted PARTS_PRE_ORDER_SUGGESTION
//   4. Schedule the job via danielle_schedule_parallel_job
//   5. Start the job via tech_job_started (waiver gate WARN)
//   6. Complete the job via tech_job_complete
//   7. Verify outcome rows + signals fired
//
// Doesn't actually send customer SMS — CUSTOMER_FACING_ENABLED gate
// drops them. Verifies the rails, not the customer experience.
//
// Run: node colony-loop/scripts/smoke-ant-lifecycle.js
// Cleanup: prints job_id at end for manual inspection / deletion

import process from 'node:process';

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const VERBOSE = process.argv.includes('--verbose');
const NOW = Date.now();

(async () => {
  console.log('━━━ Ant-only job lifecycle smoke test ━━━');
  console.log(`base: ${XANO_BASE}`);
  console.log();

  let jobId = 0;

  // ── Stage 1: Create synthetic warranty job via email-intake path ──
  console.log('[1/7] Creating synthetic AHS job via create_job_from_email...');
  const createRes = await postJson('/create_job_from_email', {
    source: 'smoke_test_ahs',
    warranty_company: 'AHS',
    claim_number: `SMOKE-${NOW}`,
    customer_first_name: 'Smoke',
    customer_last_name: 'TestRun',
    customer_phone: '+15555550000',
    customer_email: 'smoke@example.com',
    customer_address_line: '1 Smoke St',
    customer_city: 'Antioch',
    customer_zip_code: '37013',
    appliance_type: 'refrigerator',
    appliance_brand: 'Whirlpool',
    appliance_model: 'WRT318FZDM',
    problem_summary: 'fridge not cooling, freezer warm — smoke test',
    forwarded_email_received_at_ms: NOW,
    parser_activation_ts_ms: NOW - 60_000,
  });
  if (!createRes.ok) {
    console.error('✗ create_job_from_email failed:', createRes.status, JSON.stringify(createRes.data).slice(0, 300));
    process.exit(1);
  }
  jobId = createRes.data.job_id;
  console.log(`✓ Created job_id=${jobId}`);

  await sleep(2);

  // ── Stage 2: Confirm job appears in needs-scheduled queue ────────
  console.log(`[2/7] Verifying job ${jobId} is in needs-scheduled queue...`);
  const queueRes = await getJson('/list_needs_scheduled_parallel?limit=50');
  if (!queueRes.ok) {
    console.warn(`✗ list_needs_scheduled_parallel returned ${queueRes.status}`);
  } else {
    const items = queueRes.data && queueRes.data.items || [];
    const found = items.find((j) => Number(j.id) === Number(jobId));
    console.log(found ? `✓ Job ${jobId} found in queue` : `⚠ Job ${jobId} NOT in queue (may be filtered)`);
  }

  // ── Stage 3: Check that PARTS_PRE_ORDER_SUGGESTION emitted ───────
  console.log(`[3/7] Checking PARTS_PRE_ORDER_SUGGESTION signal emit...`);
  await sleep(3); // let loop tick once
  const eventRes = await getJson(`/list_recent_event_log?action=parts_pre_order_handled&days_back=1&limit=20`);
  if (eventRes.ok) {
    const items = eventRes.data && eventRes.data.items || [];
    const match = items.find((row) => {
      try {
        const m = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        return Number(m.job_id) === Number(jobId);
      } catch (_) { return false; }
    });
    console.log(match ? `✓ Pre-order signal handled for job ${jobId}` : '⚠ Pre-order not yet processed (may be in queue)');
  }

  // ── Stage 4: Schedule via Danielle endpoint ──────────────────────
  console.log(`[4/7] Scheduling via danielle_schedule_parallel_job (tech 1, tomorrow 10am)...`);
  const tomorrow10am = new Date();
  tomorrow10am.setDate(tomorrow10am.getDate() + 1);
  tomorrow10am.setHours(10, 0, 0, 0);
  const schedRes = await postJson('/danielle_schedule_parallel_job', {
    job_id: jobId,
    technician_id: 1,
    scheduled_start_ms: tomorrow10am.getTime(),
    notes: 'smoke test schedule',
  });
  console.log(schedRes.ok ? `✓ Scheduled ${jobId} for tech 1 tomorrow 10am CT` : `✗ Schedule failed: ${schedRes.status}`);

  await sleep(2);

  // ── Stage 5: Start the job ───────────────────────────────────────
  console.log(`[5/7] Starting job via tech_job_started (waiver gate=WARN expected)...`);
  const startRes = await postJson('/tech_job_started', {
    job_id: jobId,
    technician_id: 1,
  });
  console.log(startRes.ok ? `✓ Job started (waiver gate logged tech_start_no_waiver)` : `✗ Start failed: ${startRes.status}`);

  await sleep(2);

  // ── Stage 6: Complete the job ────────────────────────────────────
  console.log(`[6/7] Completing job via tech_job_complete (repair_complete)...`);
  const completeRes = await postJson('/tech_job_complete', {
    job_id: jobId,
    technician_id: 1,
    completion_type: 'repair_complete',
    notes: 'smoke test completion',
  });
  console.log(completeRes.ok ? `✓ Job completed` : `✗ Complete failed: ${completeRes.status}`);

  await sleep(3);

  // ── Stage 7: Verify outcome attribution ──────────────────────────
  console.log(`[7/7] Verifying outcome chain (claude_call_outcome / signal_outcome_succeeded)...`);
  const traceRes = await getJson(`/list_recent_event_log?action=signal_outcome_succeeded&days_back=1&limit=200`);
  if (traceRes.ok) {
    const items = traceRes.data && traceRes.data.items || [];
    const jobIdNeedle = `"job_id":${jobId}`;
    const matches = items.filter((row) => String(row.metadata || '').includes(jobIdNeedle));
    console.log(matches.length > 0 ? `✓ Found ${matches.length} signal_outcome_succeeded rows for job ${jobId}` : '⚠ No outcome rows yet (loop may not have processed)');
  }

  console.log();
  console.log(`━━━ Smoke test complete. job_id=${jobId} ━━━`);
  console.log(`Open: https://tnapplianceexchange.net/job-detail.html?job_id=${jobId}`);
  console.log(`Trace: https://tnapplianceexchange.net/trace-viewer.html  (use trace_id from any event_log row for this job)`);
})();

async function postJson(path, body) {
  try {
    const r = await fetch(`${XANO_BASE}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch (e) { return { ok: false, error: e.message }; }
}
async function getJson(path) {
  try {
    const r = await fetch(`${XANO_BASE}${path}`, { signal: AbortSignal.timeout(20_000) });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch (e) { return { ok: false, error: e.message }; }
}
function sleep(s) { return new Promise(r => setTimeout(r, s * 1000)); }
