import { config } from './config.js';

// Retry transient network failures (TypeError: fetch failed, DNS blips,
// TLS reset). HTTP errors (4xx/5xx response bodies) fall through to the
// JSON parser unchanged. Backoff: 0, 250ms, 750ms.
//
// Each attempt is bounded by a 30-second AbortController timeout — without
// this, a single fetch can hang for minutes when an underlying TCP
// connection goes half-dead (observed multiple 15-minute hangs in the
// 2026-05-26 overnight log). 30s is well above normal Xano latency (~200ms
// p99) while keeping the worst-case tick at 90s (3 attempts × 30s).
const FETCH_TIMEOUT_MS = 30 * 1000;

async function fetchWithRetry(url, opts = {}) {
  const delays = [0, 250, 750];
  let lastErr;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) {
      await new Promise((r) => setTimeout(r, delays[i]));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } catch (err) {
      // Treat aborts (DOMException AbortError) as retryable timeouts —
      // same class of fault as a half-dead TCP connection.
      const isAbort = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
      if (!isAbort && !(err instanceof TypeError)) throw err;
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function postJSON(url, body) {
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (!res.ok) {
    const err = new Error(`xano ${url} -> ${res.status}: ${txt.slice(0, 200)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function getJSON(url) {
  const res = await fetchWithRetry(url, { method: 'GET' });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (!res.ok) {
    const err = new Error(`xano ${url} -> ${res.status}: ${txt.slice(0, 200)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

const INTAKE = () => config.xanoIntakeBase;
const CASH_TDR = () => config.xanoCashTdrBase;

export async function fetchPendingSignals(limit = 50) {
  const data = await getJSON(`${INTAKE()}/get_pending_colony_signals?limit=${limit}`);
  return data.items || [];
}

export async function markSignalProcessed(signalId, resultAction, resultObj) {
  const merged = resultAction ? { signal_id: signalId, ...(resultObj || {}) } : null;
  return postJSON(`${INTAKE()}/mark_signal_processed`, {
    signal_id: signalId,
    result_action: resultAction || '',
    result_json: merged ? JSON.stringify(merged) : '',
  });
}

export async function emitSignal({ signal_type, signal_strength = 50, source_colony, target_colonies = '', payload = {} }) {
  return postJSON(`${INTAKE()}/emit_colony_signal`, {
    signal_type,
    signal_strength,
    source_colony: source_colony || config.colonyName,
    target_colonies,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

export function logLocal(action, metadata = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), action, ...metadata });
  console.log(line);
}

export async function getDailyBriefingFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_daily_briefing_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getDailyTechBriefingFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_daily_tech_briefing_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getTechnicians() {
  return getJSON(`${INTAKE()}/technicians`);
}

export async function getTechDailyDashboard(techId, date) {
  let url = `${INTAKE()}/get_tech_daily_dashboard?tech_id=${encodeURIComponent(techId)}`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
  return getJSON(url);
}

export async function getColonyArchitectFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_colony_architect_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getAppointmentConfirmationSent(jobId, scheduledStartMs) {
  return getJSON(`${INTAKE()}/get_appointment_confirmation_sent?job_id=${jobId}&scheduled_start_ms=${scheduledStartMs}`);
}

export async function getGreetingSentForJob(jobId) {
  return getJSON(`${INTAKE()}/get_greeting_sent_for_job?job_id=${jobId}`);
}

export async function getWarrantySubmissionHandled(jobId) {
  return getJSON(`${INTAKE()}/get_warranty_submission_handled?job_id=${jobId}`);
}

export async function getWarrantySubmissionContext(jobId) {
  return getJSON(`${INTAKE()}/get_warranty_submission_context?job_id=${jobId}`);
}

export async function getTechAssignmentHandled(jobId, technicianId) {
  return getJSON(`${INTAKE()}/get_tech_assignment_handled?job_id=${jobId}&technician_id=${technicianId}`);
}

export async function getTechAssignmentContext(jobId, technicianId) {
  return getJSON(`${INTAKE()}/get_tech_assignment_context?job_id=${jobId}&technician_id=${technicianId}`);
}

export async function sendSms(to, message, context = {}) {
  if (config.dryRun) {
    console.log(`[DRY_RUN sendSms] to=${to} msg=${message.slice(0, 80)}`);
    return { success: true, dry_run: true };
  }
  return postJSON(`${INTAKE()}/send_sms`, { to, message, context });
}

export async function qcCockpitLoad(jobId) {
  return getJSON(`${INTAKE()}/qc_cockpit_load?job_id=${jobId}`);
}

export async function sendQcDiagnosisToCustomer(jobId, opts = {}) {
  if (config.dryRun) {
    console.log(`[DRY_RUN send_qc_diagnosis] job=${jobId}`);
    return { success: true, dry_run: true };
  }
  return postJSON(`${CASH_TDR()}/send_qc_diagnosis_to_customer`, { job_id: jobId, ...opts });
}

export async function createTdr(payload) {
  return postJSON(`${INTAKE()}/create_tdr`, payload);
}

export async function getJobsForDashboard({ date_filter = 'all', page = 1, per_page = 200 } = {}) {
  return postJSON(`${INTAKE()}/get_jobs_for_dashboard`, { date_filter, page, per_page });
}

export async function s3ViewUrl(s3Key) {
  return postJSON(`${config.netlifyFunctionsBase}/s3-view-url`, { s3_key: s3Key });
}

export async function getAutoScheduleContext(jobId) {
  return getJSON(`${INTAKE()}/get_auto_schedule_context?job_id=${jobId}`);
}

export async function enqueueSchedulingQueuePropose(jobId, source = 'try_auto_schedule', priority = 1) {
  return postJSON(`${INTAKE()}/enqueue_scheduling_queue_propose`, { job_id: jobId, source, priority });
}

export async function recordHeartbeat({ colony, uptime_ms, signals_processed_in_window } = {}) {
  return postJSON(`${INTAKE()}/record_heartbeat`, {
    colony: colony || '',
    uptime_ms: uptime_ms || 0,
    signals_processed_in_window: signals_processed_in_window || 0,
  });
}

export async function recordEventLog(action, metadata = {}) {
  return postJSON(`${INTAKE()}/record_event_log`, {
    action: String(action || ''),
    metadata_json: JSON.stringify(metadata || {}),
  });
}

export async function getPrediagSentForJob(jobId) {
  return getJSON(`${INTAKE()}/get_prediag_sent_for_job?job_id=${jobId}`);
}

export async function getDailyJobPrepFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_daily_job_prep_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getUndiagnosedJobsNext3Days(daysAhead = 3) {
  return getJSON(`${INTAKE()}/get_undiagnosed_jobs_next_3_days?days_ahead=${daysAhead}`);
}

export async function getPriorVisitsForCustomer(customerId, applianceType, excludeJobId, months = 12) {
  const params = new URLSearchParams({
    customer_id: String(customerId),
    appliance_type: String(applianceType || ''),
    exclude_job_id: String(excludeJobId || 0),
    months: String(months),
  });
  return getJSON(`${INTAKE()}/get_prior_visits_for_customer?${params.toString()}`);
}

export async function getJobArrivalStatus(jobId) {
  return getJSON(`${INTAKE()}/get_job_arrival_status?job_id=${jobId}`);
}
