// Shared Ant tool library — used by tech-assist-brain.js + office-ant-brain.js
// and any future Ant brain (customer-side, scheduler-side, etc).
//
// Each brain decides which tool subset to expose by picking entries from
// READ_TOOLS / SCHEDULER_TOOLS / WRITE_TOOLS arrays. Brains stay separate
// (own prompts, own audiences, own permissions); this lib is just the
// shared plumbing so we don't reinvent fetches + definitions per brain.
//
// Adding a new tool = (1) add definition to one of the TOOLS arrays,
// (2) add execution case to executeTool. Then it's available to any
// brain that imports it.

const XANO_BASE = process.env.XANO_INTAKE_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TOOL_FETCH_TIMEOUT_MS = 10_000;

// ─── HTTP helper with timeout ────────────────────────────────────────
async function timedFetch(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TOOL_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    clearTimeout(t);
    return { error: err.name === 'AbortError' ? 'timeout' : (err.message || String(err)) };
  }
}

// ─── READ TOOLS (safe for any brain) ────────────────────────────────
const READ_TOOLS = [
  {
    name: 'get_customer_service_history',
    description: 'Get prior service history for a customer (every job we have done for them, with diagnosis + repair + tech). Returns up to N most recent prior jobs, excluding the optional current job.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'integer', description: 'Customer ID' },
        exclude_job_id: { type: 'integer', description: 'Optional job ID to exclude (e.g. the current job)' },
        limit: { type: 'integer', description: 'Max prior jobs to return (default 10)' },
      },
      required: ['customer_id'],
    },
  },
  {
    name: 'get_common_failures_for_model',
    description: 'Get the most common failure modes for this brand + appliance type, based on every TDR our techs have submitted. Returns the top failed components + likely part numbers + frequency. Use when narrowing a diagnosis or before suggesting what to check first.',
    input_schema: {
      type: 'object',
      properties: {
        brand: { type: 'string', description: 'Brand name (LG, Whirlpool, GE, etc.)' },
        appliance_type: { type: 'string', description: 'Appliance type (refrigerator, dryer, range, etc.)' },
        model_number: { type: 'string', description: 'Optional: full model number for more specific results' },
      },
      required: ['brand', 'appliance_type'],
    },
  },
  {
    name: 'get_office_todo',
    description: 'Get the prioritized list of things that need a human in the office to take action: stale intake jobs, held jobs, parts arrived (need to schedule second visit), warranty completions blocked on TDR, callbacks. Use to answer "what should I work on?" / "what needs attention?"',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_needs_scheduled_queue',
    description: 'Get jobs in the parallel-mode Needs Scheduled queue — jobs that landed via warranty email (AHS, ServicePower, Allstate) and need someone to assign a tech + time.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max jobs to return (default 25)' } },
      required: [],
    },
  },
  {
    name: 'get_calendar_week',
    description: 'Get the office calendar overview for a week — jobs per tech per day. Used for scheduling decisions: "is Jimmy overloaded Thursday?" / "who has capacity tomorrow?" / "what does next week look like?"',
    input_schema: {
      type: 'object',
      properties: {
        week_start_ms: { type: 'integer', description: 'Optional week start (Monday) in unix ms. Defaults to current week.' },
        region: { type: 'string', description: 'Optional region filter: "tn" or "la"' },
      },
      required: [],
    },
  },
  {
    name: 'get_tech_performance',
    description: 'Get a tech\'s performance metrics over a period: jobs completed, first-visit-fix rate, average time per job. Use when reviewing a tech\'s recent work or deciding who to assign a job to.',
    input_schema: {
      type: 'object',
      properties: {
        tech_id: { type: 'integer', description: 'Which tech (1=Teddy, 2=Jimmy, 3=Andre, 4=Lee, 5=Billy, 6=John)' },
        days: { type: 'integer', description: 'Days back to summarize (default 30)' },
      },
      required: ['tech_id'],
    },
  },
  {
    name: 'get_office_pulse',
    description: 'Get the live activity feed — last N significant events (jobs created, TDRs saved, errors, signals processed). Use for "what just happened?" / investigating recent activity.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max events (default 30)' } },
      required: [],
    },
  },
  {
    name: 'search_customers',
    description: 'Search the customer database by phone, name, address, or email. Returns up to 25 matches with their most recent job. Use to look up "the Smith on Belle Meade" or "did we ever do work for 615-555-1234".',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search text — phone number, name, address fragment, email' } },
      required: ['query'],
    },
  },
];

// ─── SCHEDULER TOOLS (read-only safe for any brain) ─────────────────
const SCHEDULER_TOOLS = [
  {
    name: 'get_tech_availability_for_date',
    description: 'Check whether a tech is working a given date, marked off, or partial-day off. Returns their working hours + any blocked windows. Use before suggesting a slot for that tech.',
    input_schema: {
      type: 'object',
      properties: {
        tech_id: { type: 'integer', description: 'Tech ID (1=Teddy, 2=Jimmy, 3=Andre, 4=Lee, 5=Billy, 6=John)' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD' },
      },
      required: ['tech_id', 'date'],
    },
  },
  {
    name: 'check_scheduling_conflict',
    description: 'Check whether scheduling a job for a tech at a given time would overlap with their other jobs that day. Returns conflicting jobs if any.',
    input_schema: {
      type: 'object',
      properties: {
        tech_id: { type: 'integer', description: 'Tech ID' },
        scheduled_start_ms: { type: 'integer', description: 'Proposed start time in unix ms' },
        duration_minutes: { type: 'integer', description: 'Job duration in minutes (default 90)' },
        exclude_job_id: { type: 'integer', description: 'Optional — exclude this job from the check (useful when rescheduling)' },
      },
      required: ['tech_id', 'scheduled_start_ms'],
    },
  },
];

// ─── WRITE TOOLS (gated — only office brain exposes these) ──────────
// CRITICAL: every write tool defaults dry_run=true. Claude returns a
// preview of what WOULD happen. Only when the caller explicitly sets
// dry_run=false does the actual write fire. Every write is audited
// to event_log with action='ant_write_tool_executed'.
const WRITE_TOOLS = [
  {
    name: 'schedule_job',
    description: 'Assign a tech + scheduled_start to an existing unscheduled job. Used when picking up a job from Needs Scheduled queue. DEFAULTS to dry_run=true (preview only). Set dry_run=false to actually write.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'integer' },
        tech_id: { type: 'integer' },
        scheduled_start_ms: { type: 'integer', description: 'Start time in unix ms' },
        dry_run: { type: 'boolean', description: 'If true (default), preview only. If false, actually write.' },
      },
      required: ['job_id', 'tech_id', 'scheduled_start_ms'],
    },
  },
  {
    name: 'reschedule_job',
    description: 'Move an existing job to a new time. Fires APPOINTMENT_SCHEDULED signal which auto-SMSes the customer their new time confirmation. DEFAULTS to dry_run=true.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'integer' },
        new_scheduled_start_ms: { type: 'integer', description: 'New start time in unix ms' },
        reason: { type: 'string', description: 'Brief reason (audit trail)' },
        dry_run: { type: 'boolean' },
      },
      required: ['job_id', 'new_scheduled_start_ms'],
    },
  },
  {
    name: 'reassign_job',
    description: 'Reassign an existing job to a different tech. Fires TECH_ASSIGNED signal which auto-SMSes the new tech + customer about the change. DEFAULTS to dry_run=true.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'integer' },
        new_tech_id: { type: 'integer' },
        reason: { type: 'string' },
        dry_run: { type: 'boolean' },
      },
      required: ['job_id', 'new_tech_id'],
    },
  },
  {
    name: 'cancel_job',
    description: 'Cancel a job with a reason. Fires JOB_CANCELED signal which SMSes the customer + tech. DEFAULTS to dry_run=true. Use sparingly — cancellations are rare.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'integer' },
        reason: { type: 'string', description: 'Why canceled (customer-visible)' },
        dry_run: { type: 'boolean' },
      },
      required: ['job_id', 'reason'],
    },
  },
  {
    name: 'set_tech_day_off',
    description: 'Mark a tech off for a date. Writes tech_availability with full_day_off=true. Use when a tech reports sick or asks for a day off. DEFAULTS to dry_run=true.',
    input_schema: {
      type: 'object',
      properties: {
        tech_id: { type: 'integer' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD' },
        reason: { type: 'string', description: 'Optional reason (e.g. "sick", "vacation")' },
        dry_run: { type: 'boolean' },
      },
      required: ['tech_id', 'date'],
    },
  },
];

// ─── Tool execution dispatch ────────────────────────────────────────
// Single switch — adding a tool means adding (1) the definition above
// in the right array, (2) a case here. Brains never touch this; they
// just call executeTool(name, input, ctx).
async function executeTool(toolName, toolInput, ctx) {
  const ti = toolInput || {};
  ctx = ctx || {};
  switch (toolName) {
    case 'get_customer_service_history': {
      const cid = ti.customer_id || ctx.customer_id;
      if (!cid) return { error: 'customer_id required' };
      const qs = `customer_id=${cid}&limit=${ti.limit || 10}` + (ti.exclude_job_id ? `&exclude_job_id=${ti.exclude_job_id}` : (ctx.job_id ? `&exclude_job_id=${ctx.job_id}` : ''));
      return await timedFetch(`${XANO_BASE}/assist_get_customer_history?${qs}`, { method: 'GET' });
    }
    case 'get_common_failures_for_model': {
      const brand = encodeURIComponent(ti.brand || ctx.brand || '');
      const appl = encodeURIComponent(ti.appliance_type || ctx.appliance || '');
      const model = encodeURIComponent(ti.model_number || '');
      return await timedFetch(`${XANO_BASE}/get_common_failures?brand=${brand}&appliance_type=${appl}&model_number=${model}&per_page=10`, { method: 'GET' });
    }
    case 'get_office_todo':
      return await timedFetch(`${XANO_BASE}/get_office_todo`, { method: 'GET' });
    case 'get_needs_scheduled_queue':
      return await timedFetch(`${XANO_BASE}/list_needs_scheduled_parallel?limit=${ti.limit || 25}`, { method: 'GET' });
    case 'get_calendar_week': {
      const qs = [];
      if (ti.week_start_ms) qs.push(`week_start_ms=${ti.week_start_ms}`);
      if (ti.region) qs.push(`region=${encodeURIComponent(ti.region)}`);
      return await timedFetch(`${XANO_BASE}/get_office_calendar_week${qs.length ? '?' + qs.join('&') : ''}`, { method: 'GET' });
    }
    case 'get_tech_performance': {
      if (!ti.tech_id) return { error: 'tech_id required' };
      return await timedFetch(`${XANO_BASE}/get_tech_performance?tech_id=${ti.tech_id}&days=${ti.days || 30}`, { method: 'GET' });
    }
    case 'get_office_pulse':
      return await timedFetch(`${XANO_BASE}/get_office_pulse?limit=${ti.limit || 30}`, { method: 'GET' });
    case 'search_customers': {
      if (!ti.query) return { error: 'query required' };
      return await timedFetch(`${XANO_BASE}/office_universal_search?q=${encodeURIComponent(ti.query)}`, { method: 'GET' });
    }

    // ─── Scheduler read tools ─────────────────────────────────────
    case 'get_tech_availability_for_date': {
      if (!ti.tech_id || !ti.date) return { error: 'tech_id + date required' };
      // Compute the day window in CT (00:00 → 23:59:59 CT) and check
      // tech_availability + count of scheduled jobs for that date.
      const dayStart = new Date(`${ti.date}T00:00:00-05:00`).getTime();
      const dayEnd = dayStart + 24 * 3600 * 1000 - 1;
      const cal = await timedFetch(`${XANO_BASE}/get_office_calendar_week?week_start_ms=${dayStart}`, { method: 'GET' });
      if (cal.error) return cal;
      // Filter the week response to just this date + tech
      const techDay = (cal.days || []).find((d) => d.date_ms >= dayStart && d.date_ms <= dayEnd);
      const tech = techDay ? (techDay.techs || []).find((t) => t.tech_id === ti.tech_id) : null;
      return {
        success: true,
        tech_id: ti.tech_id,
        date: ti.date,
        is_day_off: tech ? !!tech.day_off : false,
        job_count: tech ? (tech.job_count || 0) : 0,
        jobs: tech ? (tech.jobs || []) : [],
      };
    }
    case 'check_scheduling_conflict': {
      if (!ti.tech_id || !ti.scheduled_start_ms) return { error: 'tech_id + scheduled_start_ms required' };
      const startMs = ti.scheduled_start_ms;
      const duration = (ti.duration_minutes || 90) * 60 * 1000;
      const endMs = startMs + duration;
      const dayStart = Math.floor(startMs / (24 * 3600 * 1000)) * (24 * 3600 * 1000);
      const cal = await timedFetch(`${XANO_BASE}/get_office_calendar_week?week_start_ms=${dayStart}`, { method: 'GET' });
      if (cal.error) return cal;
      const conflicts = [];
      for (const d of (cal.days || [])) {
        for (const t of (d.techs || [])) {
          if (t.tech_id !== ti.tech_id) continue;
          for (const j of (t.jobs || [])) {
            if (ti.exclude_job_id && j.job_id === ti.exclude_job_id) continue;
            const js = j.scheduled_start || 0;
            const je = js + ((j.duration_minutes || 90) * 60 * 1000);
            if (js < endMs && je > startMs) {
              conflicts.push({ job_id: j.job_id, customer: j.customer_name, scheduled_start: js });
            }
          }
        }
      }
      return {
        success: true,
        has_conflict: conflicts.length > 0,
        conflicts,
      };
    }

    // ─── Write tools (dry_run-gated) ──────────────────────────────
    case 'schedule_job': {
      if (!ti.job_id || !ti.tech_id || !ti.scheduled_start_ms) {
        return { error: 'job_id + tech_id + scheduled_start_ms required' };
      }
      const dryRun = ti.dry_run !== false;
      const dt = new Date(ti.scheduled_start_ms).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });
      if (dryRun) {
        return {
          success: true,
          dry_run: true,
          preview: `Would schedule job #${ti.job_id} to tech ${ti.tech_id} at ${dt} CT. Set dry_run=false to commit.`,
        };
      }
      const writeRes = await timedFetch(`${XANO_BASE}/auto_book_existing_job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: ti.job_id,
          technician_id: ti.tech_id,
          scheduled_start_ms: ti.scheduled_start_ms,
          source: 'ant_office_brain',
        }),
      });
      return { success: !writeRes.error, dry_run: false, committed: true, write_result: writeRes };
    }
    case 'reschedule_job': {
      if (!ti.job_id || !ti.new_scheduled_start_ms) return { error: 'job_id + new_scheduled_start_ms required' };
      const dryRun = ti.dry_run !== false;
      const dt = new Date(ti.new_scheduled_start_ms).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });
      if (dryRun) {
        return {
          success: true,
          dry_run: true,
          preview: `Would reschedule job #${ti.job_id} to ${dt} CT. Reason: ${ti.reason || '(none given)'}. Customer + tech will receive auto-SMS confirmation. Set dry_run=false to commit.`,
        };
      }
      const writeRes = await timedFetch(`${XANO_BASE}/reschedule_job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: ti.job_id,
          new_scheduled_start_ms: ti.new_scheduled_start_ms,
          reason: ti.reason || 'office_rescheduled_via_ant',
          source: 'ant_office_brain',
        }),
      });
      return { success: !writeRes.error, dry_run: false, committed: true, write_result: writeRes };
    }
    case 'reassign_job': {
      if (!ti.job_id || !ti.new_tech_id) return { error: 'job_id + new_tech_id required' };
      const dryRun = ti.dry_run !== false;
      if (dryRun) {
        return {
          success: true,
          dry_run: true,
          preview: `Would reassign job #${ti.job_id} to tech ${ti.new_tech_id}. Reason: ${ti.reason || '(none given)'}. New tech + customer will receive auto-SMS. Set dry_run=false to commit.`,
        };
      }
      const writeRes = await timedFetch(`${XANO_BASE}/reassign_job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: ti.job_id,
          new_technician_id: ti.new_tech_id,
          reason: ti.reason || 'office_reassigned_via_ant',
          source: 'ant_office_brain',
        }),
      });
      return { success: !writeRes.error, dry_run: false, committed: true, write_result: writeRes };
    }
    case 'cancel_job': {
      if (!ti.job_id || !ti.reason) return { error: 'job_id + reason required' };
      const dryRun = ti.dry_run !== false;
      if (dryRun) {
        return {
          success: true,
          dry_run: true,
          preview: `Would cancel job #${ti.job_id} with reason: "${ti.reason}". Customer + tech will receive auto-SMS. Set dry_run=false to commit.`,
        };
      }
      const writeRes = await timedFetch(`${XANO_BASE}/cancel_job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: ti.job_id,
          reason: ti.reason,
          source: 'ant_office_brain',
        }),
      });
      return { success: !writeRes.error, dry_run: false, committed: true, write_result: writeRes };
    }
    case 'set_tech_day_off': {
      if (!ti.tech_id || !ti.date) return { error: 'tech_id + date required' };
      const dryRun = ti.dry_run !== false;
      if (dryRun) {
        return {
          success: true,
          dry_run: true,
          preview: `Would mark tech ${ti.tech_id} off on ${ti.date}. Reason: ${ti.reason || '(none given)'}. Existing jobs on that day will need reassignment. Set dry_run=false to commit.`,
        };
      }
      const writeRes = await timedFetch(`${XANO_BASE}/tech_set_day_off`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tech_id: ti.tech_id,
          date: ti.date,
          full_day_off: true,
          reason: ti.reason || 'set_via_ant',
        }),
      });
      return { success: !writeRes.error, dry_run: false, committed: true, write_result: writeRes };
    }

    default:
      return { error: `unknown tool: ${toolName}` };
  }
}

// Convenience: pick a subset of tools by name (helps brains assemble
// only the tools they want to expose without copy-pasting definitions)
function pickTools(allTools, names) {
  const set = new Set(names);
  return allTools.filter(t => set.has(t.name));
}

module.exports = {
  READ_TOOLS,
  SCHEDULER_TOOLS,
  WRITE_TOOLS,
  ALL_TOOLS: [...READ_TOOLS, ...SCHEDULER_TOOLS, ...WRITE_TOOLS],
  executeTool,
  pickTools,
  timedFetch,
  XANO_BASE,
};
