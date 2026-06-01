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

  // ──────────────────────────────────────────────────────────────
  // Endpoints — alphabetical
  // ──────────────────────────────────────────────────────────────
  const api = {
    // Office cancel — delegates to transition_job_state behind the scenes.
    async cancelJob({ job_id, reason } = {}) {
      return call('POST', '/cancel_job', { job_id, reason });
    },

    // Office Today bundle.
    async getOfficeToday() {
      return call('GET', '/get_office_today');
    },

    // Dashboard bucket-filtered jobs.
    async getJobsForDashboard({ page = 1, per_page = 100, status, date_filter = 'all' } = {}) {
      return call('POST', '/get_jobs_for_dashboard', { page, per_page, status, date_filter });
    },

    // Tech's day plan for a given date.
    async getTechDailyDashboard({ tech_id, date } = {}) {
      return call('GET', '/get_tech_daily_dashboard', { tech_id, date });
    },

    // Real-time SMS activity.
    async getSmsPulse({ minutes_back = 60 } = {}) {
      return call('GET', '/get_sms_pulse', { minutes_back });
    },

    // Office reschedule.
    async rescheduleJob({ job_id, new_start_ms } = {}) {
      return call('POST', '/reschedule_job', { job_id, new_start_ms });
    },

    // Tech 'Start Job'.
    async techJobStarted({ job_id, technician_id } = {}) {
      return call('POST', '/tech_job_started', { job_id, technician_id });
    },

    // Tech 'Complete'.
    async techJobComplete({ job_id, technician_id, completion_type } = {}) {
      return call('POST', '/tech_job_complete', { job_id, technician_id, completion_type });
    },

    // Customer SMS gate toggle.
    async toggleCustomerSmsGate({ enabled, actor = 'office_today' } = {}) {
      return call('POST', '/toggle_customer_sms_gate', { enabled, actor });
    },

    // The canonical state transition. Most pages should NOT call this
    // directly — they call the higher-level wrappers above (cancelJob,
    // rescheduleJob, techJobStarted, etc.) which delegate here. Exposed
    // for power-user surfaces (admin tools, debugger pages).
    async transitionJobState({ job_id, target_state, actor, reason, technician_id, scheduled_start_ms, force_revert = false } = {}) {
      return call('POST', '/transition_job_state', {
        job_id, target_state, actor, reason, technician_id, scheduled_start_ms, force_revert,
      });
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
    window.Ant.apiVersion = '0.1.0';
    window.Ant.apiBase = BASE;
  }
})();
