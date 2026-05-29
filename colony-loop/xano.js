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

// Returns count of unprocessed colony_signals matching (signal_type, job_id).
// Used by hold-and-re-emit agents to skip re-emit when a pending signal
// already covers the same job → prevents per-tick churn.
export async function countPendingSignalsForJob(signalType, jobId) {
  const url = `${INTAKE()}/count_pending_signals_for_job?signal_type=${encodeURIComponent(signalType)}&job_id=${encodeURIComponent(jobId)}`;
  const res = await fetchWithRetry(url, { method: 'GET' });
  if (!res.ok) return { success: false, pending_count: 0 };
  return res.json();
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

export async function getPartsArrivalDue(todayCt) {
  let url = `${INTAKE()}/get_parts_arrival_due`;
  if (todayCt) url += `?today_ct=${encodeURIComponent(todayCt)}`;
  return getJSON(url);
}

export async function getPartsFollowupSent(jobId, partsEtaDate) {
  return getJSON(`${INTAKE()}/get_parts_followup_sent?job_id=${jobId}&parts_eta_date=${encodeURIComponent(partsEtaDate)}`);
}

export async function getPartsArrivalCheckFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_parts_arrival_check_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getEventLogByAction(action) {
  return getJSON(`${INTAKE()}/get_event_log_by_action?action=${encodeURIComponent(action)}`);
}

export async function getWaiverStatus(jobId) {
  return getJSON(`${INTAKE()}/get_waiver_status?job_id=${jobId}`);
}

export async function getTechsWithOpenTdr(todayCt) {
  let url = `${INTAKE()}/get_techs_with_open_tdr`;
  if (todayCt) url += `?today_ct=${encodeURIComponent(todayCt)}`;
  return getJSON(url);
}

export async function getTdrReminderFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_tdr_reminder_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getUnpaidSelfPayJobs(daysBack) {
  let url = `${INTAKE()}/get_unpaid_self_pay_jobs`;
  if (daysBack) url += `?days_back=${daysBack}`;
  return getJSON(url);
}

export async function getUnpaidDigestFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_unpaid_digest_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getResumeChatPending(hoursSinceGreeting, limit) {
  const params = new URLSearchParams();
  if (hoursSinceGreeting) params.set('hours_since_greeting', String(hoursSinceGreeting));
  if (limit) params.set('limit', String(limit));
  const q = params.toString();
  return getJSON(`${INTAKE()}/get_resume_chat_pending${q ? '?' + q : ''}`);
}

export async function getResumeNudgeFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_resume_nudge_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getTechsLateToFirstJob(cutoffHourCt) {
  let url = `${INTAKE()}/get_techs_late_to_first_job`;
  if (cutoffHourCt) url += `?cutoff_hour_ct=${cutoffHourCt}`;
  return getJSON(url);
}

export async function getTechLateCheckFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_tech_late_check_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getOfficeTodo() {
  return getJSON(`${INTAKE()}/get_office_todo`);
}

export async function getOfficeMorningBriefingFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_office_morning_briefing_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getTdrCompletenessReportFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_tdr_completeness_report_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getOfficeEodSummary() {
  return getJSON(`${INTAKE()}/get_office_eod_summary`);
}

export async function getOfficeEodSummaryFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_office_eod_summary_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function sendSms(to, message, context = {}) {
  if (config.dryRun) {
    console.log(`[DRY_RUN sendSms] to=${to} msg=${message.slice(0, 80)}`);
    return { success: true, dry_run: true };
  }
  const primary = postJSON(`${INTAKE()}/send_sms`, { to, message, context });
  // Vacation backup: if backup phone is set AND this SMS is going to the
  // owner, also send to the backup number (Danielle) so critical alerts
  // are received while Teddy is away. Adds a "[bkup]" prefix so backup
  // recipient knows it's a CC, not a primary.
  const owner = (config.ownerPhone || '').replace(/\D/g, '').slice(-10);
  const target = (to || '').replace(/\D/g, '').slice(-10);
  const backup = (config.vacationBackupPhone || '').trim();
  if (backup && owner && target && owner === target) {
    const backupMsg = `[bkup] ${message}`;
    // Fire-and-forget (don't block primary)
    postJSON(`${INTAKE()}/send_sms`, { to: backup, message: backupMsg, context: { ...context, _backup_of: to } }).catch((err) => {
      console.warn('[vacation-backup] secondary send failed:', err.message || err);
    });
  }
  return primary;
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

export async function getTechForZip(zip, waiverSigned = true) {
  return postJSON(`${INTAKE()}/get_tech_for_zip`, { zip_code: zip, waiver_signed: waiverSigned });
}

export async function getTechConstraintsForDate({ technician_id, date_ymd, day_start_ms, day_end_ms, day_of_week_lower }) {
  let q = `technician_id=${technician_id}&date_ymd=${encodeURIComponent(date_ymd)}&day_start_ms=${day_start_ms}&day_end_ms=${day_end_ms}`;
  if (day_of_week_lower) q += `&day_of_week_lower=${encodeURIComponent(day_of_week_lower)}`;
  return getJSON(`${INTAKE()}/get_tech_constraints_for_date?${q}`);
}

export async function getTechPerformance({ tech_id, period = 'week' }) {
  return getJSON(`${INTAKE()}/get_tech_performance?tech_id=${tech_id}&period=${encodeURIComponent(period)}`);
}

export async function getTechWeeklyRecapSent({ tech_id, week_start_ms }) {
  return getJSON(`${INTAKE()}/get_tech_weekly_recap_sent?tech_id=${tech_id}&week_start_ms=${week_start_ms}`);
}

export async function getTechSessionsForLoopWatch(tech_id, now_ms) {
  return getJSON(`${INTAKE()}/get_tech_sessions_for_loop_watch?technician_id=${tech_id}&now_ms=${now_ms}`);
}

export async function getTechAssistEodStats(tech_id) {
  return getJSON(`${INTAKE()}/get_tech_assist_eod_stats?technician_id=${tech_id}`);
}

export async function assignParallelTestJob(tech_id) {
  return postJSON(`${INTAKE()}/assign_parallel_test_job`, { technician_id: tech_id });
}

export async function autoBookExistingJob({ job_id, technician_id, scheduled_start_ms, scheduled_end_ms, source = 'auto_scheduler' }) {
  return postJSON(`${INTAKE()}/auto_book_existing_job`, {
    job_id,
    technician_id,
    scheduled_start_ms,
    scheduled_end_ms: scheduled_end_ms || null,
    source,
  });
}

export async function listAhsBacklog(page = 1, perPage = 100) {
  return getJSON(`${INTAKE()}/list_ahs_backlog?page=${page}&per_page=${perPage}`);
}

export async function sendFeedbackSms({ job_id, customer_phone, customer_first_name }) {
  return postJSON(`${INTAKE()}/send_feedback_sms`, {
    job_id,
    customer_phone,
    customer_first_name,
  });
}

export async function getPartsIntelForJob(jobId) {
  return getJSON(`${INTAKE()}/get_parts_intel_for_job?job_id=${jobId}`);
}

export async function getPartsDecisionHandled(jobId) {
  return getJSON(`${INTAKE()}/get_parts_decision_handled?job_id=${jobId}`);
}

export async function getWeeklyPerformanceFired(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_weekly_performance_fired?since_ts_ms=${sinceTsMs}`);
}

export async function getOfficeCalendarWeek(weekStartCt) {
  const qs = weekStartCt ? `?week_start=${encodeURIComponent(weekStartCt)}` : '';
  return getJSON(`${INTAKE()}/get_office_calendar_week${qs}`);
}

export async function getScheduleGapCheckFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_schedule_gap_check_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getCapacityCheckFiredToday(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_capacity_check_fired_today?since_ts_ms=${sinceTsMs}`);
}

export async function getDailyRevenueFired(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_daily_revenue_fired?since_ts_ms=${sinceTsMs}`);
}

export async function getDailyRevenueSummary(sinceTsMs) {
  return getJSON(`${INTAKE()}/get_daily_revenue_summary?since_ts_ms=${sinceTsMs}`);
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

// Alias used by newer agents.
export async function recordEvent(action, metadata = {}) {
  return recordEventLog(action, metadata);
}

// Generic recent event_log fetch. Used by warranty learning aggregator
// to scan corrections within a window. Returns an array of rows with
// {id, action, metadata, created_at}.
export async function listRecentEventLog({ action, days_back = 14, limit = 1000 } = {}) {
  const params = new URLSearchParams({
    action: String(action || ''),
    days_back: String(days_back),
    limit: String(limit),
  });
  const r = await getJSON(`${INTAKE()}/list_recent_event_log?${params.toString()}`);
  return (r && r.items) || r || [];
}

// Has an action with this day-key value already fired today?
// Used by daily-fired agents (briefings, aggregator) for idempotency.
export async function checkEventLogFiredToday(action, dayKey) {
  const params = new URLSearchParams({
    action: String(action || ''),
    day_key: String(dayKey || ''),
  });
  const r = await getJSON(`${INTAKE()}/check_event_log_fired_today?${params.toString()}`);
  return !!(r && r.fired);
}

// Fetch a job's full dashboard view (job + customer + appliance + TDRs
// + attachments). Used by agents that need rich job context.
export async function getJobForDashboard(jobId) {
  return postJSON(`${INTAKE()}/get_job_for_dashboard`, { job_id: jobId });
}

// Returns the open awaiting_parts queue (lean shape) used by the
// parts_delivery_observation_handler matcher. Fields:
//   id, customer_name, service_zip, service_city, part_number,
//   model_number, order_number
export async function listAwaitingPartsJobs({ limit = 100 } = {}) {
  try {
    const r = await getJSON(`${INTAKE()}/list_awaiting_parts_jobs?limit=${limit}`);
    return (r && Array.isArray(r.items)) ? r.items : [];
  } catch (_) {
    return [];
  }
}

// Canonical "parts arrived" trigger — same endpoint office UI hits.
// Source string is recorded in metadata for audit traceability.
export async function markPartsArrived({ job_id, source, notes = '' }) {
  return postJSON(`${INTAKE()}/mark_parts_arrived`, { job_id, source, notes });
}

// Find open / parts-ready jobs near a tech's recent location. Used by
// the scheduler_fill_gap agent to surface fill-in work when a tech
// wraps ahead of schedule.
export async function findNearbyOpenJobs({ tech_id, recent_zip = '', recent_city = '', limit = 10 } = {}) {
  const params = new URLSearchParams({ tech_id: String(tech_id), limit: String(limit) });
  if (recent_zip) params.append('recent_zip', recent_zip);
  if (recent_city) params.append('recent_city', recent_city);
  return getJSON(`${INTAKE()}/find_nearby_open_jobs?${params.toString()}`);
}

// Returns the raw inbound SMS samples for comms-style classification.
// Classifier lives in channel.js (JS-side) — XS just bulk-returns the
// metadata rows.
export async function getCustomerCommsStyleSamples(customerId, { days_back = 60, limit = 50 } = {}) {
  if (!customerId) return [];
  try {
    const params = new URLSearchParams({
      customer_id: String(customerId),
      days_back: String(days_back),
      limit: String(limit),
    });
    const r = await getJSON(`${INTAKE()}/get_customer_comms_style?${params.toString()}`);
    return (r && Array.isArray(r.items)) ? r.items : [];
  } catch (_) {
    return [];
  }
}

// Returns a customer's preferred comms channel based on their last 60d
// of portal vs SMS engagement. See get_customer_channel_preference_GET.xs.
// Shape: { prefers: "portal" | "sms" | "unknown", score, evidence: {...} }
export async function getCustomerChannelPreference(customerId) {
  if (!customerId) return { prefers: 'unknown', score: 0, evidence: {} };
  try {
    return await getJSON(`${INTAKE()}/get_customer_channel_preference?customer_id=${customerId}`);
  } catch (_) {
    return { prefers: 'unknown', score: 0, evidence: {} };
  }
}

// Lists active warranty_requirement_override rows for a vendor (or all).
export async function listWarrantyRequirementOverrides({ warranty_company = '', days_back = 30 } = {}) {
  const params = new URLSearchParams({
    days_back: String(days_back),
  });
  if (warranty_company) params.append('warranty_company', warranty_company);
  const r = await getJSON(`${INTAKE()}/list_warranty_requirement_overrides?${params.toString()}`);
  return (r && r.overrides) || [];
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
