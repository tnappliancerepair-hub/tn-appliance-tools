// Ant API client — the canonical interface for browser pages.
//
// Instead of:
//   fetch('https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/cancel_job', { ... })
//
// Pages call:
//   await window.Ant.api.cancelJob({ job_id: 123, reason: 'office' })
//
// Why: Xano endpoint URLs + field names live in ONE place. Renaming a Xano
// field requires editing only this file, not every browser page.
//
// Generated from api-spec/ant-api.yaml. Versioned per endpoint via the
// x-version field in the spec.

(function () {
  const BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

  // Single fetch helper — handles JSON serialization + error shape.
  async function call(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    let url = BASE + path;
    if (method === 'GET' && body) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined && v !== null) params.set(k, String(v));
      }
      const q = params.toString();
      if (q) url += '?' + q;
    } else if (body) {
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
    return r.json();
  }

  // Convenience wrapper that auto-includes Content-Type and matches the
  // call() signature for endpoints that take a custom request body.
  async function rawCall(method, path, opts = {}) {
    const r = await fetch(BASE + path, opts);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
    return r.json();
  }

  // ──────────────────────────────────────────────────────────────
  // Endpoints — alphabetical
  // ──────────────────────────────────────────────────────────────
  const api = {
    // Approve a payroll batch.
    async approvePayroll(body) { return call('POST', '/approve_payroll', body); },

    // Office cancel — delegates to transition_job_state behind the scenes.
    async cancelJob({ job_id, reason } = {}) { return call('POST', '/cancel_job', { job_id, reason }); },

    // Clear a voicemail event.
    async clearVoicemail({ event_log_id, cleared_by = 'office' } = {}) {
      return call('POST', '/clear_voicemail', { event_log_id, cleared_by });
    },

    // Email-source job creation. Used by polling functions; rarely from browser.
    async createJobFromEmail(body) { return call('POST', '/create_job_from_email', body); },

    // Web-chat-source job creation (customer-facing chat intake).
    async createJobFromChat(body) { return call('POST', '/create_job_from_chat', body); },

    // Voicemail draft → job creation.
    async createJobFromVoicemail({ source_event_log_id } = {}) {
      return call('POST', '/create_job_from_voicemail', { source_event_log_id });
    },

    // Submit a TDR (tech decision report).
    async createTdr(body) { return call('POST', '/create_tdr', body); },

    // Danielle's parallel-mode scheduling action from needs-scheduled.
    async danielleScheduleParallelJob(body) { return call('POST', '/danielle_schedule_parallel_job', body); },

    // Emit any colony_signal (admin / debug path).
    async emitColonySignal({ signal_type, signal_strength = 50, payload = {} } = {}) {
      return call('POST', '/emit_colony_signal', { signal_type, signal_strength, payload });
    },

    // Notify the office (or customer) of a parts event (ordered/shipped/arrived/delayed).
    async emitPartsEvent(body) { return call('POST', '/emit_parts_event', body); },

    // Structured escalation to Teddy with A/B/C options.
    async escalateToTeddy(body) { return call('POST', '/escalate_to_teddy', body); },

    // Get a signed S3 upload URL for an attachment.
    async generateUploadUrl(body) { return call('POST', '/generate_upload_url', body); },

    // Money-side dashboard data.
    async getFinancialDashboard(params = {}) { return call('GET', '/get_financial_dashboard', params); },

    // One-job detail bundle.
    async getJobForDashboard({ job_id } = {}) { return call('POST', '/get_job_for_dashboard', { job_id }); },

    // Resume chat context (minimal-PII; phone last4 auth).
    async getJobResumeContext(body) { return call('POST', '/get_job_resume_context', body); },

    // Dashboard bucket-filtered jobs.
    async getJobsForDashboard({ page = 1, per_page = 100, status, date_filter = 'all' } = {}) {
      return call('POST', '/get_jobs_for_dashboard', { page, per_page, status, date_filter });
    },

    // Calendar week view (per tech, day grid).
    async getOfficeCalendarWeek(params = {}) { return call('GET', '/get_office_calendar_week', params); },

    // Kanban board of jobs by phase.
    async getOfficeKanban(params = {}) { return call('GET', '/get_office_kanban', params); },

    // Office Today bundle.
    async getOfficeToday() { return call('GET', '/get_office_today'); },

    // Payroll period report.
    async getPayrollReport(params = {}) { return call('GET', '/get_payroll_report', params); },

    // Real-time SMS activity.
    async getSmsPulse({ minutes_back = 60 } = {}) { return call('GET', '/get_sms_pulse', { minutes_back }); },

    // Tech's day plan for a given date.
    async getTechDailyDashboard({ tech_id, date } = {}) {
      return call('GET', '/get_tech_daily_dashboard', { tech_id, date });
    },

    // Client-side debug logger (writes to event_log).
    async logClientDebug(body) { return call('POST', '/log_client_debug', body); },

    // Manual payment entry (cash / check / Venmo / Zelle).
    async manualPaymentEntry(body) { return call('POST', '/manual_payment_entry', body); },

    // Parts markup calculator.
    async partsMarkupCalc(body) { return call('POST', '/parts_markup_calc', body); },

    // Bulk-cancel test + stale jobs (Clean button).
    async purgeTestAndStaleJobs({ dry_run = true, mode = 'both', stale_days = 30, max_cancel = 2000 } = {}) {
      return call('POST', '/purge_test_and_stale_jobs', { dry_run, mode, stale_days, max_cancel });
    },

    // Record an arbitrary tech GPS point (used by tech-ant-chat's OTW broadcast).
    async recordTechPosition(body) { return call('POST', '/record_tech_position', body); },

    // Record a warranty correction (Alyse's reconciliation tool).
    async recordWarrantyCorrection(body) { return call('POST', '/record_warranty_correction', body); },

    // Mark a warranty job as submitted (with confirmation #).
    async recordWarrantySubmission(body) { return call('POST', '/record_warranty_submission', body); },

    // Resolve a customer payment dispute.
    async resolveDispute(body) { return call('POST', '/resolve_dispute', body); },

    // Office reschedule — delegates to transition_job_state.
    async rescheduleJob({ job_id, new_start_ms } = {}) {
      return call('POST', '/reschedule_job', { job_id, new_start_ms });
    },

    // Save an attachment row (after S3 upload).
    async saveAttachment(body) { return call('POST', '/save_attachment', body); },

    // Send a job intake-link SMS to a customer (warranty resume flow).
    async sendIntakeLinkSms(body) { return call('POST', '/send_intake_link_sms', body); },

    // Reschedule with smart A/B/C slot offer to customer.
    async smartRescheduleCustomer(body) { return call('POST', '/smart_reschedule_customer', body); },

    // Tech Ant Assist chat — Claude scribe.
    async techAssistChat(body) { return call('POST', '/tech_assist_chat', body); },

    // Tech 'Complete'.
    async techJobComplete({ job_id, technician_id, completion_type } = {}) {
      return call('POST', '/tech_job_complete', { job_id, technician_id, completion_type });
    },

    // Tech 'Start Job'.
    async techJobStarted({ job_id, technician_id } = {}) {
      return call('POST', '/tech_job_started', { job_id, technician_id });
    },

    // Tech 'On the Way' — fires customer ETA SMS.
    async techOnTheWay(body) { return call('POST', '/tech_on_the_way', body); },

    // Customer SMS gate toggle.
    async toggleCustomerSmsGate({ enabled, actor = 'office_today' } = {}) {
      return call('POST', '/toggle_customer_sms_gate', { enabled, actor });
    },

    // The canonical state transition. Most pages should NOT call this
    // directly — they call the higher-level wrappers above (cancelJob,
    // rescheduleJob, techJobStarted, etc.) which delegate here.
    async transitionJobState({ job_id, target_state, actor, reason, technician_id, scheduled_start_ms, force_revert = false } = {}) {
      return call('POST', '/transition_job_state', {
        job_id, target_state, actor, reason, technician_id, scheduled_start_ms, force_revert,
      });
    },

    // Customer resume-chat update (when they tap the SMS link + fill the form).
    async updateJobFromChat(body) { return call('POST', '/update_job_from_chat', body); },

    // Office password gate verification.
    async verifyOfficePassword({ password } = {}) {
      return call('POST', '/verify_office_password', { password });
    },
  };

  // Expose as window.Ant.api so pages can use it like:
  //   const d = await window.Ant.api.getOfficeToday();
  //
  // Older pages that still call raw fetch keep working — migration is
  // incremental. New pages should use window.Ant.api exclusively.
  if (typeof window !== 'undefined') {
    window.Ant = window.Ant || {};
    window.Ant.api = api;
    window.Ant.apiVersion = '0.2.0';
    window.Ant.apiBase = BASE;
  }
})();
