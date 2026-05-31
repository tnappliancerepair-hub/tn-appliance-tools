// RESET RUN
// Bulk-deletes all data tagged with a given test_run_id across the tables
// touched by the test cycle. Use between iterations to reset state.
//
// Request: POST /.netlify/functions/reset-run
//   body: { test_run_id, dry_run (default false) }
//
// Tables scanned + deletes-by-match-criterion:
//   jobs:                      test_run_id == X (direct column)
//   technician_decision_report: job_id IN (deleted job_ids)
//   scheduling_queue:           job_id IN (deleted job_ids)
//   broadcast_attempt:          job_id IN (deleted job_ids)
//   mock_assignment:            run_id starts with X OR job_id IN (deleted job_ids)
//   job_event:                  job_id IN (deleted job_ids)
//   job_financial:              job_id IN (deleted job_ids)
//   job_email_event:            job_id IN (deleted job_ids)
//   customer:                   id IN (deleted job customer_ids) AND first_name suggests synthetic
//   event_log:                  action like tech_requested_reassignment + metadata mentions job_id
//
// Customers: only delete if THEIR job_count drops to zero (don't accidentally
// remove a customer who exists from real intake).

const XANO_META_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const TABLES = {
  jobs: 7,
  technician_decision_report: 12,
  scheduling_queue: 25,
  broadcast_attempt: 23,
  mock_assignment: 45,
  job_event: 13,
  job_financial: 11,
  job_email_event: 33,
  customer: 5,
  event_log: 3,
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'method not allowed' });
  }
  if (!process.env.XANO_METADATA_TOKEN) {
    return json(500, { ok: false, error: 'XANO_METADATA_TOKEN missing' });
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { ok: false, error: 'invalid json body' }); }

  const testRunId = (body.test_run_id || '').trim();
  const dryRun = body.dry_run === true || body.dry_run === 'true';
  if (!testRunId) {
    return json(400, { ok: false, error: 'test_run_id required' });
  }

  const counts = {};
  const errors = [];

  try {
    // Step 1: find all jobs tagged with this test_run_id
    const jobs = await fetchAllByPredicate(TABLES.jobs, (r) => r.test_run_id === testRunId);
    counts.jobs_found = jobs.length;
    const jobIds = jobs.map((j) => j.id);
    const customerIds = [...new Set(jobs.map((j) => j.customer_id).filter((c) => c && c > 0))];

    if (dryRun) {
      return json(200, {
        ok: true,
        dry_run: true,
        test_run_id: testRunId,
        would_delete: {
          jobs: jobIds.length,
          customers_to_evaluate: customerIds.length,
          message: 'No deletes performed — pass dry_run=false to actually delete',
        },
      });
    }

    // Step 2: cascade delete from downstream tables BEFORE deleting jobs
    counts.tdrs = await bulkDeleteWhereJobIdIn(TABLES.technician_decision_report, jobIds, errors);
    counts.scheduling_queue = await bulkDeleteWhereJobIdIn(TABLES.scheduling_queue, jobIds, errors);
    counts.broadcast_attempt = await bulkDeleteWhereJobIdIn(TABLES.broadcast_attempt, jobIds, errors);
    counts.mock_assignment = await bulkDeleteWhereJobIdIn(TABLES.mock_assignment, jobIds, errors);
    counts.job_event = await bulkDeleteWhereJobIdIn(TABLES.job_event, jobIds, errors);
    counts.job_financial = await bulkDeleteWhereJobIdIn(TABLES.job_financial, jobIds, errors);
    counts.job_email_event = await bulkDeleteWhereJobIdIn(TABLES.job_email_event, jobIds, errors);

    // Also delete mock_assignment rows by run_id prefix (in case a run created assignments
    // before any jobs were tagged — defensive)
    const mockByRunId = await fetchAllByPredicate(
      TABLES.mock_assignment,
      (r) => (r.run_id || '').startsWith(`mock_`) && jobIds.includes(r.job_id),
    );
    if (mockByRunId.length > counts.mock_assignment) {
      counts.mock_assignment += await bulkDelete(TABLES.mock_assignment, mockByRunId.map((r) => r.id), errors);
    }

    // Step 3: delete the jobs themselves
    counts.jobs_deleted = await bulkDelete(TABLES.jobs, jobIds, errors);

    // Step 4: customers — only delete those whose ONLY remaining jobs were ours.
    // After step 3, query for any remaining jobs by these customer_ids.
    let customersDeleted = 0;
    const allRemainingJobs = await fetchAll(TABLES.jobs);
    const customerIdsStillReferenced = new Set(allRemainingJobs.map((j) => j.customer_id));
    const customersToDelete = customerIds.filter((cid) => !customerIdsStillReferenced.has(cid));
    customersDeleted = await bulkDelete(TABLES.customer, customersToDelete, errors);
    counts.customers_deleted = customersDeleted;
    counts.customers_kept = customerIds.length - customersDeleted;

    return json(200, {
      ok: true,
      test_run_id: testRunId,
      counts,
      error_count: errors.length,
      errors: errors.slice(0, 10),
    });
  } catch (e) {
    return json(500, {
      ok: false,
      error: String(e.message || e),
      counts,
      error_sample: errors.slice(0, 5),
    });
  }
};

async function fetchAll(tableId, perPage = 2000) {
  const first = await metaGet(`/table/${tableId}/content?page=1&per_page=${perPage}`);
  let items = first.items || [];
  const pageTotal = first.pageTotal || 1;
  for (let p = 2; p <= pageTotal; p++) {
    const next = await metaGet(`/table/${tableId}/content?page=${p}&per_page=${perPage}`);
    items = items.concat(next.items || []);
  }
  return items;
}

async function fetchAllByPredicate(tableId, predicate) {
  const all = await fetchAll(tableId);
  return all.filter(predicate);
}

async function bulkDeleteWhereJobIdIn(tableId, jobIds, errors) {
  if (!jobIds.length) return 0;
  const all = await fetchAll(tableId);
  const idsToDelete = all
    .filter((r) => jobIds.includes(r.job_id))
    .map((r) => r.id);
  return await bulkDelete(tableId, idsToDelete, errors);
}

async function bulkDelete(tableId, rowIds, errors) {
  if (!rowIds.length) return 0;
  const concurrency = 8;
  let idx = 0;
  let okCount = 0;
  const worker = async () => {
    while (idx < rowIds.length) {
      const i = idx++;
      const rid = rowIds[i];
      try {
        const r = await fetch(`${XANO_META_BASE}/table/${tableId}/content/${rid}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${process.env.XANO_METADATA_TOKEN}` },
        });
        if (r.ok) okCount++;
        else errors.push({ table: tableId, row_id: rid, status: r.status });
      } catch (e) {
        errors.push({ table: tableId, row_id: rid, err: String(e.message || e) });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return okCount;
}

async function metaGet(path) {
  const r = await fetch(`${XANO_META_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.XANO_METADATA_TOKEN}` },
  });
  if (!r.ok) throw new Error(`meta GET ${path} HTTP ${r.status}`);
  return r.json();
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}
