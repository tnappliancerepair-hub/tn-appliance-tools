// MOCK SCHEDULER — Netlify function
// Ports mockup/engine.js algorithm onto live Xano data.
// MOCK_MODE: never writes to jobs.scheduling_status, never sends SMS, never touches
// live appointments. Writes plan to mock_assignment table + summary event_log row.
//
// APPLY MODE (?apply=true): writes plan to LIVE jobs table — sets technician_id,
// scheduled_start, scheduled_end, scheduling_status="scheduled". Also deletes any
// auto-enqueued scheduling_queue rows for those job_ids so the PICK1/2/3 SMS
// pathway doesn't fire. Customer SMS still gated by server-side CUSTOMER_FACING_ENABLED.
//
// Request: GET /.netlify/functions/mock-scheduler?limit=30&dry_run=true
//   limit:    int, default 30, max 500
//   dry_run:  if true, returns the plan without writing anything (default false)
//   apply:    if true, write to LIVE jobs table; overrides dry_run (default false)
//   day_offset: int (default 1), days ahead from today to schedule (1 = tomorrow)
//   run_id:   optional; auto-generated as `mock_<ms>` if absent
//
// Response: { ok, run_id, summary:{...}, by_tech:{...}, unrouted:[...], mock_sms:[...] }

const XANO_INTAKE_BASE = process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const XANO_META_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';

const TABLES = {
  jobs: 7,
  service_zone: 9,
  cluster_assignment: 17,
  technicians: 15,
  mock_assignment: 45,
  event_log: 3,
};

// ─────────────────────────────────────────────────────────────────────
// CONSTANTS — copied verbatim from mockup/engine.js
// ─────────────────────────────────────────────────────────────────────
const DAY_START = 8 * 60; // 08:00 CT
const DAY_END = 17 * 60; // 17:00 CT
const SERVICE_MIN = 30;
const CAP = 6;
const AVG_MPH = 35;
const MIN_HOP_MIN = 8;
const MOCK_TELNYX_TECH = '+16158578800';

// Town centroids. Source: mockup/engine.js. Used for haversine distance.
// Cities not in this map fall through to cluster-centroid fallback below.
const TOWNS = {
  Antioch: [36.060, -86.672],
  'South Nashville': [36.130, -86.770],
  Nashville: [36.162, -86.781],
  'West Nashville': [36.150, -86.860],
  Murfreesboro: [35.846, -86.390],
  Hermitage: [36.187, -86.603],
  'Mt Juliet': [36.200, -86.519],
  Clarksville: [36.530, -87.359],
  Bellevue: [36.075, -86.945],
  Pegram: [36.100, -87.050],
  'Ashland City': [36.274, -87.064],
  'Kingston Springs': [36.100, -87.114],
  Joelton: [36.310, -86.890],
  Gallatin: [36.388, -86.447],
  Smyrna: [35.983, -86.519],
  'Spring Hill': [35.751, -86.930],
  'New Orleans': [29.951, -90.071],
  Metairie: [29.984, -90.153],
  Kenner: [29.994, -90.241],
  Hammond: [30.504, -90.461],
  Ponchatoula: [30.438, -90.441],
  Slidell: [30.275, -89.781],
  Covington: [30.475, -90.101],
  Mandeville: [30.358, -90.066],
  Walker: [30.485, -90.861],
  'Baton Rouge': [30.451, -91.187],
  'Denham Springs': [30.486, -90.957],
  Gonzales: [30.238, -90.920],
  Harvey: [29.911, -90.080],
  Marrero: [29.899, -90.100],
};

// Cluster centroid fallback (rough averages of the towns assigned to each cluster).
// Used when a job's service_city isn't in TOWNS but its cluster is known.
const CLUSTER_CENTROID = {
  'TN Metro': [36.10, -86.70],
  'TN Northwest': [36.30, -87.10],
  'TN East': [36.10, -86.50],
  'LA South': [29.97, -90.13],
  'LA North': [30.40, -90.20],
  'LA West': [30.45, -90.95],
};

// ─────────────────────────────────────────────────────────────────────
// HELPERS — copied verbatim from mockup/engine.js, no logic changes
// ─────────────────────────────────────────────────────────────────────
function haversineMiles(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function getCoord(town) {
  return TOWNS[town] || null;
}

function driveMin(townA, townB, fallbackA, fallbackB) {
  if (townA === townB) return 0;
  const a = getCoord(townA) || fallbackA;
  const b = getCoord(townB) || fallbackB;
  if (!a || !b) return MIN_HOP_MIN;
  const mins = (haversineMiles(a, b) / AVG_MPH) * 60;
  return Math.max(MIN_HOP_MIN, Math.round(mins));
}

function driveMiles(townA, townB, fallbackA, fallbackB) {
  if (townA === townB) return 0;
  const a = getCoord(townA) || fallbackA;
  const b = getCoord(townB) || fallbackB;
  if (!a || !b) return 0;
  return haversineMiles(a, b);
}

// engine.js evaluateRoute — exact copy, modified only to accept coord fallbacks
function evaluateRoute(homeCoord, route) {
  let curCoord = homeCoord;
  let curTime = DAY_START;
  let totalDrive = 0;
  const stops = [];
  for (const job of route) {
    const jobCoord = getCoord(job.town) || job._fallbackCoord || homeCoord;
    const d = driveMinFromCoords(curCoord, jobCoord);
    totalDrive += d;
    const arrive = curTime + d;
    let start;
    if (job.window) {
      start = Math.max(arrive, job.window[0]);
      if (start > job.window[1]) return { feasible: false };
      if (start + SERVICE_MIN > DAY_END) return { feasible: false };
    } else {
      start = Math.max(arrive, DAY_START);
      if (start + SERVICE_MIN > DAY_END) return { feasible: false };
    }
    const end = start + SERVICE_MIN;
    stops.push({ job, arrive, start, end, driveIn: d });
    curCoord = jobCoord;
    curTime = end;
  }
  return { feasible: true, stops, totalDrive, dayEnd: curTime };
}

function driveMinFromCoords(a, b) {
  if (!a || !b || (a[0] === b[0] && a[1] === b[1])) return 0;
  const mins = (haversineMiles(a, b) / AVG_MPH) * 60;
  return Math.max(MIN_HOP_MIN, Math.round(mins));
}

// engine.js buildDay — anchors then cheapest-insertion
function buildDay(homeCoord, jobs) {
  const anchored = jobs
    .filter((j) => j.window)
    .sort((a, b) => a.window[0] - b.window[0] || a.window[1] - b.window[1]);
  const flexible = jobs.filter((j) => !j.window);

  let route = [];
  const overflow = [];

  for (const a of anchored) {
    if (route.length >= CAP) {
      overflow.push({ job: a, reason: 'cap' });
      continue;
    }
    const test = evaluateRoute(homeCoord, [...route, a]);
    if (test.feasible) route.push(a);
    else overflow.push({ job: a, reason: 'window-conflict' });
  }

  let pending = [...flexible];
  while (pending.length && route.length < CAP) {
    let best = null;
    for (let pi = 0; pi < pending.length; pi++) {
      const job = pending[pi];
      const baseEval = evaluateRoute(homeCoord, route);
      const baseDrive = baseEval.feasible ? baseEval.totalDrive : Infinity;
      for (let pos = 0; pos <= route.length; pos++) {
        const trial = [...route.slice(0, pos), job, ...route.slice(pos)];
        const ev = evaluateRoute(homeCoord, trial);
        if (!ev.feasible) continue;
        const added = ev.totalDrive - baseDrive;
        if (!best || added < best.added) best = { pi, pos, added };
      }
    }
    if (!best) break;
    const job = pending.splice(best.pi, 1)[0];
    route = [...route.slice(0, best.pos), job, ...route.slice(best.pos)];
  }
  for (const j of pending) {
    overflow.push({
      job: j,
      reason: route.length >= CAP ? 'cap' : 'no-fit',
    });
  }

  const finalEval = evaluateRoute(homeCoord, route);
  return { eval: finalEval, overflow };
}

function scheduleAllByTech(jobsByTech, techs) {
  const result = {};
  for (const tid of Object.keys(jobsByTech)) {
    const t = techs[tid];
    if (!t) continue;
    const homeCoord = getCoord(t.home) || CLUSTER_CENTROID[t.cluster] || [36, -86];
    result[tid] = { tech: t, ...buildDay(homeCoord, jobsByTech[tid]) };
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// XANO LOADERS — read-only
// ─────────────────────────────────────────────────────────────────────
async function metaGet(path) {
  const r = await fetch(`${XANO_META_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.XANO_METADATA_TOKEN}` },
  });
  if (!r.ok) throw new Error(`meta GET ${path} HTTP ${r.status}`);
  return r.json();
}

async function metaPost(path, body) {
  const r = await fetch(`${XANO_META_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.XANO_METADATA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`meta POST ${path} HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function loadAllPages(tableId, perPage = 2000) {
  const first = await metaGet(`/table/${tableId}/content?page=1&per_page=${perPage}`);
  let items = first.items || [];
  const pageTotal = first.pageTotal || 1;
  for (let p = 2; p <= pageTotal; p++) {
    const next = await metaGet(`/table/${tableId}/content?page=${p}&per_page=${perPage}`);
    items = items.concat(next.items || []);
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  const startedAt = Date.now();
  const qp = event.queryStringParameters || {};
  const limit = Math.min(parseInt(qp.limit || '30', 10), 500);
  const dryRun = qp.dry_run === 'true' || qp.dry_run === '1';
  const apply = qp.apply === 'true' || qp.apply === '1';
  const testRunId = (qp.test_run_id || '').trim();
  const runId = qp.run_id || `mock_${startedAt}`;
  // PRACTICE MODE — auto-schedules ALL not_ready jobs created since cutoff_ms
  // (default Sat May 30 00:00 CT). Skips test_run_id safety gate. Tags each
  // PATCHed job with test_run_id="PRACTICE_<targetDate>" as a marker so the
  // tech dashboard can render a "🧪 PRACTICE" badge.
  const practiceMode = qp.practice_mode === 'true' || qp.practice_mode === '1';
  const practiceCutoffMs = parseInt(qp.practice_cutoff_ms || '1780117200000', 10);
  // dayOffset = how many days ahead from today (in CT) to schedule.
  // 1 = tomorrow (default). 0 = today. Used as the BASE day for flexible (AHS/self-pay)
  // jobs; SquareTrade jobs honor their own committed scheduled_start date.
  const dayOffset = parseInt(qp.day_offset || '1', 10);

  if (process.env.MOCK_MODE !== 'true' && qp.force_mock !== '1' && !apply) {
    return json(403, {
      ok: false,
      error: 'MOCK_MODE env var must be true (or pass ?force_mock=1, or ?apply=true)',
    });
  }
  if (apply && qp.confirm_apply !== '1') {
    return json(400, {
      ok: false,
      error: 'apply=true requires confirm_apply=1 (safety gate to prevent accidental live writes)',
    });
  }
  if (apply && !testRunId && !practiceMode) {
    return json(400, {
      ok: false,
      error: 'apply=true requires test_run_id OR practice_mode=1 (safety gate — would scoop legacy jobs otherwise)',
    });
  }
  if (!process.env.XANO_METADATA_TOKEN) {
    return json(500, { ok: false, error: 'XANO_METADATA_TOKEN env var missing' });
  }

  try {
    // 1) Load routing tables (small)
    const [zones, assignments, techsRows] = await Promise.all([
      loadAllPages(TABLES.service_zone, 500),
      loadAllPages(TABLES.cluster_assignment, 200),
      loadAllPages(TABLES.technicians, 100),
    ]);

    // 2) Build zip -> cluster map
    const zipToCluster = {};
    for (const z of zones) {
      const zip = (z.zip_code || '').trim();
      const cluster = (z.cluster || '').trim();
      if (zip && cluster) zipToCluster[zip] = cluster;
    }

    // 3) Build cluster -> rank-1 active tech_id map
    const clusterToTechId = {};
    for (const a of assignments) {
      if (!a.active) continue;
      const c = (a.cluster || '').trim();
      const rank = a.rank || 999;
      if (!clusterToTechId[c] || rank < clusterToTechId[c].rank) {
        clusterToTechId[c] = { tech_id: a.technician_id, rank };
      }
    }

    // 4) Build tech_id -> {name, region, cluster, home(city)} map.
    // Cluster + home town for a tech: the first zone whose technician_id matches.
    const techs = {};
    for (const t of techsRows) {
      const tid = t.id;
      if (!tid) continue;
      const cluster = Object.keys(clusterToTechId).find(
        (c) => clusterToTechId[c].tech_id === tid,
      ) || '';
      // Find a home city: pick first zone where technician_id == tid
      const homeZone = zones.find((z) => z.technician_id === tid);
      const home = homeZone ? (homeZone.market || homeZone.zone || '').trim() : '';
      const region = cluster.startsWith('TN') ? 'TN' : cluster.startsWith('LA') ? 'LA' : '';
      techs[tid] = {
        id: tid,
        name: t.first_name || t.name || `Tech ${tid}`,
        region,
        cluster,
        home,
      };
    }

    // 5) Compute the TARGET DATE for this scheduler run (today + dayOffset, CT).
    // Flexible jobs go on this date; SquareTrade anchors only included if their
    // committed scheduled_start lands on this same date.
    const targetDateMs = ctMidnightMsForOffsetDays(dayOffset);
    const targetDateYmd = formatYmdCT(targetDateMs);
    const targetDateEndMs = targetDateMs + 24 * 60 * 60 * 1000;

    // 5b) Load jobs and filter:
    // - flexibles: scheduling_status in (needs_scheduled, not_ready, prediagnosis_pending)
    //              AND no scheduled_start AND routable.
    // - anchors:   SquareTrade AND scheduled_start lands inside the target date.
    // Optional test_run_id scope: when set, restrict to jobs tagged with that run_id.
    const allJobs = await loadAllPages(TABLES.jobs, 2000);
    const isRoutable = (r) => {
      const zip = (r.service_zip || '').trim();
      const city = (r.service_city || '').trim();
      return (zip && zipToCluster[zip]) || (city && TOWNS[city]);
    };
    const matchesTestScope = (r) => !testRunId || (r.test_run_id || '') === testRunId;
    // Practice mode: only sweep jobs created since cutoff AND not already practice-tagged
    // (so re-runs don't re-touch jobs we've already auto-scheduled).
    const matchesPracticeScope = (r) =>
      !practiceMode ||
      ((r.created_at || 0) >= practiceCutoffMs &&
        !(r.test_run_id || '').startsWith('PRACTICE'));

    const flexible = allJobs.filter(
      (r) =>
        ['needs_scheduled', 'not_ready', 'prediagnosis_pending'].includes(
          r.scheduling_status || '',
        ) &&
        !r.scheduled_start &&
        isRoutable(r) &&
        matchesTestScope(r) &&
        matchesPracticeScope(r),
    );
    const anchors = allJobs.filter(
      (r) =>
        r.warranty_company === 'SquareTrade' &&
        r.scheduled_start &&
        (r.scheduled_start >= targetDateMs && r.scheduled_start < targetDateEndMs) &&
        isRoutable(r) &&
        matchesTestScope(r),
    );

    // 6) Cap to limit (flexibles first, then anchors always included).
    // Spread across clusters so the board has interesting tech-coverage instead of one big pile.
    const flexibleByCluster = {};
    for (const j of flexible) {
      const zip = (j.service_zip || '').trim();
      const c = zipToCluster[zip] || 'unknown';
      (flexibleByCluster[c] = flexibleByCluster[c] || []).push(j);
    }
    const flexibleSample = [];
    const clusterKeys = Object.keys(flexibleByCluster);
    let rrIdx = 0;
    while (flexibleSample.length < limit && clusterKeys.some((c) => flexibleByCluster[c].length > 0)) {
      const c = clusterKeys[rrIdx % clusterKeys.length];
      if (flexibleByCluster[c].length > 0) flexibleSample.push(flexibleByCluster[c].shift());
      rrIdx++;
      if (rrIdx > 10000) break; // safety
    }
    const jobs = [...flexibleSample, ...anchors];

    // 7) Map to engine input shape, attach routing
    const unrouted = [];
    const byTech = {};
    for (const j of jobs) {
      const city = (j.service_city || '').trim();
      const zip = (j.service_zip || '').trim();
      const cluster = zipToCluster[zip] || '';
      const techEntry = clusterToTechId[cluster];
      const techId = techEntry ? techEntry.tech_id : null;

      if (!techId) {
        unrouted.push({
          id: j.id,
          customer: `${j.brand || ''} ${j.appliance_type || ''}`.trim() || 'Unknown',
          town: city || `zip ${zip}`,
          reason: zip ? `no_cluster_for_zip_${zip}` : 'no_zip_or_city',
        });
        continue;
      }

      // Build window if scheduled_start (treat as anchor band — 4hr default)
      let window = null;
      if (j.scheduled_start) {
        const startMs = j.scheduled_start;
        const dt = new Date(startMs);
        const startMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
        const ctOffsetMin = 5 * 60; // UTC-5 CDT
        const ctStart = startMin - ctOffsetMin;
        const bandStart = Math.max(DAY_START, ctStart);
        const bandEnd = Math.min(DAY_END, ctStart + 4 * 60);
        if (bandStart < bandEnd) window = [bandStart, bandEnd];
      }

      const wc = (j.warranty_company || '').trim();
      const type = wc === 'SquareTrade' ? 'squaretrade' : wc === 'AHS' ? 'ahs' : 'selfpay';

      // Fallback coord for cities not in TOWNS
      const cityCoord = getCoord(city);
      const fallbackCoord = cityCoord || CLUSTER_CENTROID[cluster] || null;

      const jobObj = {
        id: j.id,
        customer: `${(j.brand || '').trim()} ${(j.appliance_type || '').trim()}`.trim() ||
                   `Job #${j.id}`,
        town: city || (cluster ? `${cluster} area` : `zip ${zip}`),
        appliance: j.appliance_type || '',
        type,
        window,
        cluster,
        _fallbackCoord: fallbackCoord,
        _zip: zip,
      };
      (byTech[techId] = byTech[techId] || []).push(jobObj);
    }

    // 8) Run engine
    const result = scheduleAllByTech(byTech, techs);

    // 9) Build mock SMS log — one summary per tech, one offer per overflow
    const mockSms = [];
    let custSuppressed = 0;
    for (const tid of Object.keys(result)) {
      const r = result[tid];
      if (!r.eval.feasible) continue;
      if (r.eval.stops.length) {
        const lines = r.eval.stops
          .map((s) => `${fmtMin(s.start)} ${s.job.customer} - ${s.job.town}`)
          .join('\n');
        mockSms.push({
          kind: 'summary',
          to: r.tech.name,
          via: MOCK_TELNYX_TECH,
          body: `MOCK - ${r.tech.name}'s schedule (${r.eval.stops.length} jobs)\n${lines}`,
        });
        custSuppressed += r.eval.stops.length;
      }
      for (const o of r.overflow) {
        mockSms.push({
          kind: 'offer',
          to: r.tech.name,
          via: MOCK_TELNYX_TECH,
          body: `MOCK OFFER - Extra job: ${o.job.customer}, ${o.job.town} (${o.job.type}). Reply Y to add.`,
        });
      }
    }

    // 10) Persist plan rows (unless dry-run)
    const writeOps = [];
    if (!dryRun) {
      // 10a) mock_assignment rows (parallel inserts, capped concurrency)
      const planRows = [];
      for (const tid of Object.keys(result)) {
        const r = result[tid];
        if (!r.eval.feasible) continue;
        r.eval.stops.forEach((s, i) => {
          planRows.push({
            run_id: runId,
            job_id: s.job.id,
            tech_id: parseInt(tid, 10),
            tech_name: r.tech.name,
            scheduled_minute_start: s.start,
            scheduled_minute_end: s.end,
            drive_in_min: s.driveIn,
            sequence_idx: i,
            is_overflow: false,
            overflow_reason: '',
            town: s.job.town,
          });
        });
        for (const o of r.overflow) {
          planRows.push({
            run_id: runId,
            job_id: o.job.id,
            tech_id: parseInt(tid, 10),
            tech_name: r.tech.name,
            scheduled_minute_start: 0,
            scheduled_minute_end: 0,
            drive_in_min: 0,
            sequence_idx: -1,
            is_overflow: true,
            overflow_reason: o.reason,
            town: o.job.town,
          });
        }
      }

      // Parallel insert via 8 workers (keep under rate limit)
      const concurrency = 8;
      let idx = 0;
      const insertOne = async () => {
        while (idx < planRows.length) {
          const i = idx++;
          try {
            await metaPost(`/table/${TABLES.mock_assignment}/content`, planRows[i]);
            writeOps.push({ kind: 'plan_row', ok: true });
          } catch (e) {
            writeOps.push({ kind: 'plan_row', ok: false, err: String(e.message || e) });
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, insertOne));

      // 10b) Single event_log summary
      const summary = {
        run_id: runId,
        techs_active: Object.keys(result).length,
        total_jobs_in: jobs.length,
        unrouted: unrouted.length,
        placed: writeOps.filter((w) => w.ok && w.kind === 'plan_row').length,
        mock_sms_count: mockSms.length,
        customer_notifications_suppressed: custSuppressed,
        limit_applied: limit,
      };
      try {
        await metaPost(`/table/${TABLES.event_log}/content`, {
          action: 'mock_scheduler_run',
          metadata: JSON.stringify(summary),
        });
      } catch (e) {
        writeOps.push({ kind: 'event_log', ok: false, err: String(e.message || e) });
      }
    }

    // 10c) APPLY MODE — write to live jobs + clear propose queue
    let applyResult = null;
    if (apply) {
      applyResult = await applyPlanToLiveJobs({
        result,
        targetDateMs,
        testRunId,
        practiceMode,
        practiceTagYmd: targetDateYmd,
      });
      // Audit log for the apply write
      try {
        await metaPost(`/table/${TABLES.event_log}/content`, {
          action: 'mock_scheduler_apply',
          metadata: JSON.stringify({
            run_id: runId,
            test_run_id: testRunId || null,
            target_date: targetDateYmd,
            jobs_patched: applyResult.jobs.ok,
            jobs_failed: applyResult.jobs.failed,
            queue_rows_deleted: applyResult.scheduling_queue.ok,
          }),
        });
      } catch (_e) {}
    }

    // 11) Build response — shape mirrors mockup engine.js output for direct UI render
    const elapsed = Date.now() - startedAt;
    const responsePayload = {
      ok: true,
      run_id: runId,
      dry_run: dryRun,
      apply,
      target_date: targetDateYmd,
      test_run_id: testRunId || null,
      summary: {
        elapsed_ms: elapsed,
        total_jobs_in: jobs.length,
        flexible_in: flexibleSample.length,
        anchors_in: anchors.length,
        techs_active: Object.keys(result).length,
        unrouted_count: unrouted.length,
        mock_sms_count: mockSms.length,
        customer_notifications_suppressed: custSuppressed,
        plan_rows_written: writeOps.filter((w) => w.ok && w.kind === 'plan_row').length,
        plan_rows_failed: writeOps.filter((w) => !w.ok && w.kind === 'plan_row').length,
        applied_jobs_patched: applyResult ? applyResult.jobs.ok : 0,
        applied_jobs_failed: applyResult ? applyResult.jobs.failed : 0,
        applied_queue_rows_deleted: applyResult ? applyResult.scheduling_queue.ok : 0,
        limit_applied: limit,
      },
      result: serializeResult(result),
      unrouted,
      mock_sms: mockSms,
      apply_result: applyResult,
    };
    return json(200, responsePayload);
  } catch (e) {
    return json(500, { ok: false, error: String(e.message || e), stack: e.stack });
  }
};

function serializeResult(result) {
  // Strip internal _fallbackCoord etc. before returning to client
  const out = {};
  for (const tid of Object.keys(result)) {
    const r = result[tid];
    const cleanStops = (r.eval.stops || []).map((s) => ({
      job: {
        id: s.job.id,
        customer: s.job.customer,
        town: s.job.town,
        appliance: s.job.appliance,
        type: s.job.type,
        window: s.job.window,
        cluster: s.job.cluster,
      },
      arrive: s.arrive,
      start: s.start,
      end: s.end,
      driveIn: s.driveIn,
    }));
    out[tid] = {
      tech: r.tech,
      eval: r.eval.feasible
        ? {
            feasible: true,
            stops: cleanStops,
            totalDrive: r.eval.totalDrive,
            dayEnd: r.eval.dayEnd,
          }
        : { feasible: false },
      overflow: (r.overflow || []).map((o) => ({
        job: {
          id: o.job.id,
          customer: o.job.customer,
          town: o.job.town,
          type: o.job.type,
        },
        reason: o.reason,
      })),
    };
  }
  return out;
}

// CT date helpers. CT = UTC-5 (CDT) most of the year.
const CT_OFFSET_HOURS = 5;
function ctMidnightMsForOffsetDays(offsetDays) {
  // Today's date in CT, plus offsetDays days, at 00:00:00 CT, returned as UTC ms.
  const nowUtcMs = Date.now();
  const ctNowMs = nowUtcMs - CT_OFFSET_HOURS * 60 * 60 * 1000;
  const ctDay = Math.floor(ctNowMs / (24 * 60 * 60 * 1000));
  const targetCtDay = ctDay + offsetDays;
  const targetCtMidnightMs = targetCtDay * 24 * 60 * 60 * 1000;
  return targetCtMidnightMs + CT_OFFSET_HOURS * 60 * 60 * 1000;
}
function formatYmdCT(utcMs) {
  const ctMs = utcMs - CT_OFFSET_HOURS * 60 * 60 * 1000;
  const d = new Date(ctMs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

// Compute the actual UTC ms timestamp for a stop given the target date and minute offset.
function stopTimestampMs(targetDateMs, minuteOffset) {
  return targetDateMs + minuteOffset * 60 * 1000;
}

// APPLY MODE: writes the plan to the live jobs table.
// For each placed (non-overflow) stop, PATCH the job with:
//   technician_id, scheduled_start, scheduled_end, scheduling_status="scheduled"
// Then bulk-delete pending propose rows from scheduling_queue for these job_ids
// so the existing PICK1/2/3 SMS path doesn't fire on already-scheduled jobs.
//
// Caller responsibility: only call this when apply=true && confirm_apply=1.
async function applyPlanToLiveJobs({ result, targetDateMs, testRunId, practiceMode, practiceTagYmd }) {
  const writes = { ok: 0, failed: 0, errors: [] };
  const placedJobIds = [];

  // Per-stop PATCH (parallel, capped concurrency)
  const stops = [];
  for (const tid of Object.keys(result)) {
    const r = result[tid];
    if (!r.eval.feasible) continue;
    for (const s of r.eval.stops) {
      stops.push({ stop: s, tech_id: parseInt(tid, 10) });
    }
  }

  const concurrency = 8;
  let idx = 0;
  const writeOne = async () => {
    while (idx < stops.length) {
      const i = idx++;
      const { stop, tech_id } = stops[i];
      const startMs = stopTimestampMs(targetDateMs, stop.start);
      const endMs = stopTimestampMs(targetDateMs, stop.end);
      const patch = {
        technician_id: tech_id,
        scheduled_start: startMs,
        scheduled_end: endMs,
        scheduling_status: 'scheduled',
      };
      // Only set test_run_id if provided AND the column exists; safe to include — Xano
      // will ignore unknown fields on PATCH per past behavior. (Confirmed via parallel_mode.)
      if (testRunId) patch.test_run_id = testRunId;
      else if (practiceMode) patch.test_run_id = `PRACTICE_${practiceTagYmd}`;

      try {
        const r = await fetch(
          `${XANO_META_BASE}/table/${TABLES.jobs}/content/${stop.job.id}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${process.env.XANO_METADATA_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(patch),
          },
        );
        if (!r.ok) {
          const t = await r.text();
          writes.failed++;
          writes.errors.push({ job_id: stop.job.id, status: r.status, body: t.slice(0, 200) });
        } else {
          writes.ok++;
          placedJobIds.push(stop.job.id);
        }
      } catch (e) {
        writes.failed++;
        writes.errors.push({ job_id: stop.job.id, err: String(e.message || e) });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, writeOne));

  // Silence existing PICK1/2/3 SMS path: delete scheduling_queue propose rows for
  // these job_ids. The queue worker would otherwise SMS Teddy with options.
  const queueDeletes = { ok: 0, failed: 0 };
  if (placedJobIds.length) {
    try {
      const qData = await metaGet(
        `/table/${TABLES.scheduling_queue}/content?page=1&per_page=2000`,
      );
      const matchingRows = (qData.items || []).filter(
        (r) =>
          placedJobIds.includes(r.job_id) &&
          (r.action_type === 'propose' || r.action_type === 'broadcast') &&
          r.status === 'pending',
      );
      let qi = 0;
      const qDeleteOne = async () => {
        while (qi < matchingRows.length) {
          const j = qi++;
          try {
            const r = await fetch(
              `${XANO_META_BASE}/table/${TABLES.scheduling_queue}/content/${matchingRows[j].id}`,
              {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${process.env.XANO_METADATA_TOKEN}` },
              },
            );
            if (r.ok) queueDeletes.ok++;
            else queueDeletes.failed++;
          } catch (_e) {
            queueDeletes.failed++;
          }
        }
      };
      await Promise.all(Array.from({ length: 6 }, qDeleteOne));
    } catch (e) {
      queueDeletes.failed = -1;
      queueDeletes.error = String(e.message || e);
    }
  }

  return { jobs: writes, scheduling_queue: queueDeletes, placed_job_ids: placedJobIds };
}

function fmtMin(m) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}
