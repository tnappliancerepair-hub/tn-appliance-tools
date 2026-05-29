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
  {
    name: 'list_recent_jobs',
    description: 'List the most recent N jobs in the system (sorted by created_at descending). Each row includes intake_source (email_servicepower, email_ahs, manual, hcp_poll, hcp_webhook, web_chat, etc.), warranty_company, scheduling_status, appliance, customer_type. Use to answer questions like "how many jobs came in via email since yesterday?", "what intake sources are we seeing this week?", "show me the last 20 jobs". You filter/count client-side based on created_at + intake_source.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max jobs to return (default 50, max 200)' },
      },
      required: [],
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
  {
    name: 'suggest_tech_for_job',
    description: 'Unbiased tech recommendation for an unscheduled job. Looks at every active tech\'s current load + geography + tech preferences (working hours, day-off, hard rules) + recent performance, and returns a ranked recommendation with reasoning. Use when picking up a Needs Scheduled job and deciding who to assign. Does NOT actually assign — call schedule_job after if you decide to go with the recommendation.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'integer', description: 'Job to suggest a tech for' },
        preferred_date_ms: { type: 'integer', description: 'Optional: date the office wants to schedule (defaults to next business day)' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'get_tech_constraints',
    description: 'Get a tech\'s full scheduling constraints for a specific date: day-off status, working window (from tech_availability OR tech default OR system), existing job count that day, hard day-of-week preferences. Use this before proposing or booking a slot to confirm the tech can actually work that time.',
    input_schema: {
      type: 'object',
      properties: {
        tech_id: { type: 'integer', description: 'Tech ID' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD' },
      },
      required: ['tech_id', 'date'],
    },
  },
  {
    name: 'find_open_slots_for_job',
    description: 'Find the best open scheduling slots for a job across the next N days. For each eligible tech (matching region + not day-off + within tech preferences), returns ranked slots with reasoning. Scoring factors: region match (in-region wins), tech load that day (lower is better), within working window, fits customer preference if specified. Returns up to 10 ranked candidates. This is the core scheduler tool — use whenever picking a slot for a job.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'integer', description: 'Job to find slots for' },
        days_ahead: { type: 'integer', description: 'Days from today to search (default 7, max 14)' },
        slot_duration_minutes: { type: 'integer', description: 'Job duration in minutes (default 90)' },
        max_results: { type: 'integer', description: 'Max ranked slots to return (default 10)' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'find_nearby_open_jobs',
    description: 'Find jobs near a given location that are READY TO BE WORKED right now — unscheduled, pending authorization, or with parts already arrived. Use when a tech runs ahead of schedule to spot fill-in work in the same neighborhood. Each candidate carries proximity_score (100=same zip, 60=same city), parts_status, ready_now flag, customer + appliance + warranty info, and age_days (older = higher priority to clear). Tech can review + pick which to add via reschedule_job / schedule_job.',
    input_schema: {
      type: 'object',
      properties: {
        tech_id: { type: 'integer', description: 'Tech whose location to search near' },
        recent_zip: { type: 'string', description: 'Zip code of where the tech just was (e.g. zip of the job they just completed). Best signal.' },
        recent_city: { type: 'string', description: 'City of where the tech just was. Fallback when zip not available.' },
        limit: { type: 'integer', description: 'Max candidates to return (default 10, max 50)' },
      },
      required: ['tech_id'],
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
  {
    name: 'draft_customer_running_behind_sms',
    description: 'Draft a customer-friendly SMS for when a tech is running behind. Returns the formatted message text — does NOT send it. Office reviews + sends via the actual SMS interface. Tone: warm, apologetic, gives clear new ETA window.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'integer' },
        minutes_late: { type: 'integer', description: 'How many minutes behind the original window' },
        new_eta_iso: { type: 'string', description: 'Optional: new arrival ETA in ISO timestamp; otherwise just minutes_late' },
        reason: { type: 'string', description: 'Optional: prior job ran long, traffic, parts delay, etc.' },
      },
      required: ['job_id', 'minutes_late'],
    },
  },
  {
    name: 'draft_customer_running_ahead_sms',
    description: 'Draft a customer-friendly SMS for when a tech is running AHEAD of schedule and could arrive earlier. Tone is opposite of running_behind: friendly heads-up + asks if the earlier time works. Customer may not be home / may need the original window. Returns draft text, does NOT send.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'integer' },
        minutes_early: { type: 'integer', description: 'How many minutes ahead of the original window the tech could arrive' },
        new_eta_iso: { type: 'string', description: 'Optional: new (earlier) arrival ETA in ISO timestamp' },
      },
      required: ['job_id', 'minutes_early'],
    },
  },
  {
    name: 'draft_warranty_submission',
    description: 'Draft a formatted warranty claim submission for the given completed job, ready to paste into the vendor portal (AHS / ServicePower / Frontdoor / etc). Returns a 5-section text package: customer info, appliance info, diagnosis, parts replaced, labor + recommendation. Office reviews + pastes into the actual vendor portal. Does NOT submit anywhere — paste-only. Highlights any missing TDR fields.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'integer' },
        vendor: { type: 'string', description: 'Vendor name (AHS, ServicePower, Frontdoor, Allstate, etc.) — used to flavor the formatting' },
      },
      required: ['job_id'],
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
    case 'list_recent_jobs': {
      const lim = Math.min(ti.limit || 50, 200);
      return await timedFetch(`${XANO_BASE}/check_recent_jobs?limit=${lim}`, { method: 'GET' });
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

    case 'suggest_tech_for_job': {
      if (!ti.job_id) return { error: 'job_id required' };
      const job = await timedFetch(`${XANO_BASE}/get_job?job_id=${ti.job_id}`, { method: 'GET' });
      if (job.error) return job;
      const dateMs = ti.preferred_date_ms || (Date.now() + 24 * 3600 * 1000);
      const dayStart = Math.floor(dateMs / (24 * 3600 * 1000)) * (24 * 3600 * 1000);
      const dayEnd = dayStart + 24 * 3600 * 1000;
      const dateYmd = new Date(dayStart).toISOString().slice(0, 10);
      const dowLower = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(dayStart).getUTCDay()];

      const cal = await timedFetch(`${XANO_BASE}/get_office_calendar_week?week_start_ms=${dayStart}`, { method: 'GET' });
      if (cal.error) return cal;

      const jobState = (job.service_state || '').toUpperCase();
      const jobRegion = (jobState === 'LA' || jobState === 'LOUISIANA') ? 'LA' : 'TN';
      const techHomeRegion = { 1: 'TN', 2: 'TN', 3: 'BOTH', 4: 'TN', 5: 'LA', 6: 'LA' };
      const techNames = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };
      const targetDay = (cal.days || []).find((d) => Math.abs(d.date_ms - dayStart) < 24 * 3600 * 1000);
      const techs = targetDay ? (targetDay.techs || []) : Object.keys(techHomeRegion).map((id) => ({ tech_id: Number(id), job_count: 0, day_off: false }));

      // Pull constraints for EVERY active tech in parallel (gives us
      // working hours + hard day-off prefs + actual existing count)
      const constraintsByTech = {};
      await Promise.all(techs.map(async (t) => {
        const c = await timedFetch(`${XANO_BASE}/get_tech_constraints_for_date?technician_id=${t.tech_id}&date_ymd=${dateYmd}&day_start_ms=${dayStart}&day_end_ms=${dayEnd}&day_of_week_lower=${dowLower}`, { method: 'GET' });
        constraintsByTech[t.tech_id] = c;
      }));

      const ranked = [];
      for (const t of techs) {
        const c = constraintsByTech[t.tech_id] || {};
        const isDayOff = !!c.is_day_off;
        if (isDayOff) continue;  // hard skip — tech can't work that day per their preferences/availability

        const tHome = techHomeRegion[t.tech_id] || 'TN';
        const regionMatch = (tHome === 'BOTH' || tHome === jobRegion);
        const existingCount = c.existing_count != null ? c.existing_count : (t.job_count || 0);
        let score = 100;
        score -= existingCount * 12;
        if (!regionMatch) score -= 35;
        if (existingCount >= 6) score -= 20;

        ranked.push({
          tech_id: t.tech_id,
          tech_name: techNames[t.tech_id] || `tech ${t.tech_id}`,
          score,
          current_load: existingCount,
          region_match: regionMatch,
          home_region: tHome,
          working_window: c.window_start && c.window_end ? `${c.window_start}-${c.window_end}` : '08:00-16:00',
          window_source: c.window_source || 'system_default',
          reason: `${techNames[t.tech_id]}: ${existingCount} jobs, ${regionMatch ? 'in-region' : 'out-of-region (' + tHome + ' → ' + jobRegion + ')'}, hours ${c.window_start || '08:00'}-${c.window_end || '16:00'}`,
        });
      }
      ranked.sort((a, b) => b.score - a.score);
      return {
        success: true,
        job_id: ti.job_id,
        job_region: jobRegion,
        date_evaluated: dateYmd,
        recommendation: ranked[0] || null,
        alternatives: ranked.slice(1, 3),
        all_scored: ranked,
        note: 'Now integrates tech_preferences via get_tech_constraints_for_date — respects day-offs, hard weekly rules, and working hours.',
      };
    }

    case 'get_tech_constraints': {
      if (!ti.tech_id || !ti.date) return { error: 'tech_id + date required' };
      const dayStart = new Date(`${ti.date}T00:00:00-05:00`).getTime();
      const dayEnd = dayStart + 24 * 3600 * 1000;
      const dowLower = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(`${ti.date}T12:00:00`).getDay()];
      return await timedFetch(`${XANO_BASE}/get_tech_constraints_for_date?technician_id=${ti.tech_id}&date_ymd=${ti.date}&day_start_ms=${dayStart}&day_end_ms=${dayEnd}&day_of_week_lower=${dowLower}`, { method: 'GET' });
    }

    case 'find_open_slots_for_job': {
      if (!ti.job_id) return { error: 'job_id required' };
      const daysAhead = Math.min(ti.days_ahead || 7, 14);
      const slotMin = ti.slot_duration_minutes || 90;
      const maxResults = ti.max_results || 10;
      const job = await timedFetch(`${XANO_BASE}/get_job?job_id=${ti.job_id}`, { method: 'GET' });
      if (job.error) return job;
      const jobState = (job.service_state || '').toUpperCase();
      const jobRegion = (jobState === 'LA' || jobState === 'LOUISIANA') ? 'LA' : 'TN';
      const techHomeRegion = { 1: 'TN', 2: 'TN', 3: 'BOTH', 4: 'TN', 5: 'LA', 6: 'LA' };
      const techNames = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };

      // Filter to in-region techs (BOTH counts)
      const eligibleTechIds = Object.keys(techHomeRegion)
        .map(Number)
        .filter((id) => {
          const h = techHomeRegion[id];
          return h === 'BOTH' || h === jobRegion;
        });

      // For each eligible tech × each day in window, pull constraints
      const slots = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let dOff = 1; dOff <= daysAhead; dOff++) {
        const dt = new Date(today.getTime() + dOff * 24 * 3600 * 1000);
        const yyyymmdd = dt.toISOString().slice(0, 10);
        const dayStart = new Date(`${yyyymmdd}T00:00:00-05:00`).getTime();
        const dayEnd = dayStart + 24 * 3600 * 1000;
        const dow = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][dt.getDay()];

        await Promise.all(eligibleTechIds.map(async (techId) => {
          const c = await timedFetch(`${XANO_BASE}/get_tech_constraints_for_date?technician_id=${techId}&date_ymd=${yyyymmdd}&day_start_ms=${dayStart}&day_end_ms=${dayEnd}&day_of_week_lower=${dow}`, { method: 'GET' });
          if (c.error || c.is_day_off) return;
          const ws = c.window_start || '08:00';
          const we = c.window_end || '16:00';
          const [wsH, wsM] = ws.split(':').map(Number);
          const [weH, weM] = we.split(':').map(Number);
          const winStart = dayStart + (wsH * 60 + wsM) * 60 * 1000;
          const winEnd = dayStart + (weH * 60 + weM) * 60 * 1000;
          const existing = (c.existing_jobs || []).map((j) => ({ start: j.scheduled_start, end: (j.scheduled_start || 0) + (j.duration_minutes || 90) * 60 * 1000 }));
          existing.sort((a, b) => a.start - b.start);
          // Greedy: try each hour-aligned offset from winStart, skipping conflicts
          for (let offset = winStart; offset + slotMin * 60 * 1000 <= winEnd; offset += 30 * 60 * 1000) {
            const slotEnd = offset + slotMin * 60 * 1000;
            const conflict = existing.find((e) => e.start < slotEnd && e.end > offset);
            if (conflict) continue;
            const existingCount = c.existing_count || 0;
            let score = 100;
            score -= existingCount * 10;  // lower load = better
            score -= (dOff - 1) * 3;       // sooner is slightly better
            // Bonus: morning slots (before noon) for first-job-of-day for low-load techs
            const slotHour = new Date(offset).getHours();
            if (existingCount === 0 && slotHour >= 8 && slotHour <= 10) score += 5;
            slots.push({
              tech_id: techId,
              tech_name: techNames[techId] || `tech ${techId}`,
              date: yyyymmdd,
              slot_start_ms: offset,
              slot_end_ms: slotEnd,
              slot_human: new Date(offset).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }),
              score,
              tech_load_that_day: existingCount,
              working_window: `${ws}-${we}`,
            });
          }
        }));
      }
      slots.sort((a, b) => b.score - a.score);
      return {
        success: true,
        job_id: ti.job_id,
        job_region: jobRegion,
        days_searched: daysAhead,
        total_slots_found: slots.length,
        top_slots: slots.slice(0, maxResults),
        note: slots.length === 0 ? 'No open slots found — every eligible tech is either off-day or fully booked across the window.' : `Top ${Math.min(maxResults, slots.length)} of ${slots.length} eligible slots. Score weights: load (lower=better), region (in-region=+0/out=-35 implied via filter), sooner=better, morning bonus.`,
      };
    }

    case 'find_nearby_open_jobs': {
      if (!ti.tech_id) return { error: 'tech_id required' };
      const params = new URLSearchParams({ tech_id: String(ti.tech_id), limit: String(ti.limit || 10) });
      if (ti.recent_zip) params.append('recent_zip', String(ti.recent_zip));
      if (ti.recent_city) params.append('recent_city', String(ti.recent_city));
      const out = await timedFetch(`${XANO_BASE}/find_nearby_open_jobs?${params.toString()}`, { method: 'GET' });
      if (out.error) return out;
      return out;
    }

    case 'draft_customer_running_behind_sms': {
      if (!ti.job_id || ti.minutes_late == null) return { error: 'job_id + minutes_late required' };
      // Read the job + customer to personalize the draft
      const job = await timedFetch(`${XANO_BASE}/get_job?job_id=${ti.job_id}`, { method: 'GET' });
      if (job.error) return job;
      const custFirst = (job.customer_first_name || job.customer_first || '').trim() || 'there';
      const appl = (job.appliance_type || 'appliance').toLowerCase();
      const techFirstFromJob = (job.assigned_tech_first || 'your tech').trim();
      let etaText;
      if (ti.new_eta_iso) {
        try {
          etaText = new Date(ti.new_eta_iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT';
        } catch (_) { etaText = `about ${ti.minutes_late} minutes behind`; }
      } else {
        etaText = `about ${ti.minutes_late} minutes behind the original window`;
      }
      const reasonClause = ti.reason ? ` (${ti.reason})` : '';
      const draft = `Hi ${custFirst} — quick heads up, ${techFirstFromJob} is running ${etaText}${reasonClause} for your ${appl}. We'll text again when on the way. Sorry for the delay. — TN Appliance`;
      return {
        success: true,
        is_draft: true,
        sent: false,
        draft_message: draft,
        note: 'This is a DRAFT only. Office reviews + sends manually via the SMS interface. Ant cannot send customer SMS directly.',
      };
    }

    case 'draft_warranty_submission': {
      if (!ti.job_id) return { error: 'job_id required' };
      const vendor = (ti.vendor || '').trim();
      // Pull job + customer + TDR
      const job = await timedFetch(`${XANO_BASE}/get_job?job_id=${ti.job_id}`, { method: 'GET' });
      if (job.error) return job;
      // TDR lives in technician_decision_report keyed by job_id. We don't
      // have a direct endpoint; reuse the customer history endpoint which
      // returns TDR fields per job.
      let tdr = {};
      if (job.customer_id) {
        const hist = await timedFetch(`${XANO_BASE}/assist_get_customer_history?customer_id=${job.customer_id}&limit=20`, { method: 'GET' });
        if (hist && Array.isArray(hist.items)) {
          const match = hist.items.find((j) => j.job_id === ti.job_id);
          if (match) tdr = match;
        }
      }

      // Highlight missing fields for the operator
      const missing = [];
      if (!tdr.tdr_diagnosis) missing.push('diagnosis');
      if (!tdr.tdr_failed_component) missing.push('failed_component');
      if (!tdr.tdr_repair) missing.push('repair_completed');
      if (!(tdr.tdr_part_number || tdr.tdr_repair)) missing.push('part_number_or_repair_detail');

      // Compose the formatted submission
      const dt = job.scheduled_start ? new Date(job.scheduled_start).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) : '(date not set)';
      const lines = [
        `WARRANTY CLAIM SUBMISSION${vendor ? ` — ${vendor.toUpperCase()}` : ''}`,
        ``,
        `=== CUSTOMER INFO ===`,
        `Name: ${(job.customer_first_name || '')} ${(job.customer_last_name || '')}`.trim() || '(missing)',
        `Phone: ${job.customer_phone || '(missing)'}`,
        `Address: ${job.service_address || ''}, ${job.service_city || ''}, ${job.service_state || ''} ${job.service_zip || ''}`,
        ``,
        `=== APPLIANCE INFO ===`,
        `Brand: ${job.brand || '(missing)'}`,
        `Appliance: ${job.appliance_type || '(missing)'}`,
        `Model #: ${job.model || job.model_number || '(missing)'}`,
        `Serial #: ${job.serial_number || '(not captured)'}`,
        ``,
        `=== SERVICE DATE ===`,
        `Visit date: ${dt} CT`,
        `Technician: ${tdr.tech_first_name || '(unknown)'}`,
        ``,
        `=== DIAGNOSIS ===`,
        tdr.tdr_diagnosis || '(NO DIAGNOSIS IN TDR — fill in via Teddy TDR Tool before submitting)',
        ``,
        `=== FAILED COMPONENT ===`,
        tdr.tdr_failed_component || '(NO FAILED COMPONENT IN TDR — required for warranty)',
        ``,
        `=== REPAIR PERFORMED ===`,
        tdr.tdr_repair || '(NO REPAIR DETAIL IN TDR — required for warranty)',
        ``,
        `=== PARTS ===`,
        `Verified part #: ${tdr.tdr_part_number || '(not captured)'}`,
        `Labor hours: ${tdr.tdr_labor_hours || '(not captured)'}`,
        ``,
        `=== CLAIM NUMBER ===`,
        job.claim_number || '(no claim # on file — verify with vendor)',
      ];
      const submission = lines.join('\n');

      return {
        success: true,
        is_draft: true,
        sent: false,
        vendor: vendor || 'GENERIC',
        job_id: ti.job_id,
        missing_fields: missing,
        ready_to_submit: missing.length === 0,
        submission_text: submission,
        note: missing.length > 0
          ? `DRAFT INCOMPLETE — ${missing.length} required fields missing (${missing.join(', ')}). Have the tech fill these before submitting.`
          : 'DRAFT COMPLETE. Copy + paste into the vendor portal.',
      };
    }

    case 'draft_customer_running_ahead_sms': {
      if (!ti.job_id || ti.minutes_early == null) return { error: 'job_id + minutes_early required' };
      const job = await timedFetch(`${XANO_BASE}/get_job?job_id=${ti.job_id}`, { method: 'GET' });
      if (job.error) return job;
      const custFirst = (job.customer_first_name || job.customer_first || '').trim() || 'there';
      const appl = (job.appliance_type || 'appliance').toLowerCase();
      const techFirstFromJob = (job.assigned_tech_first || 'your tech').trim();
      let etaText;
      if (ti.new_eta_iso) {
        try {
          etaText = new Date(ti.new_eta_iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) + ' CT';
        } catch (_) { etaText = `about ${ti.minutes_early} minutes early`; }
      } else {
        etaText = `about ${ti.minutes_early} minutes early`;
      }
      // Tone is opposite of behind: friendly heads-up + checks if earlier works
      const draft = `Hi ${custFirst} — good news, ${techFirstFromJob} is wrapping up early and could be at your place ${etaText} for your ${appl}. Does an earlier arrival work, or stick to the original time? Reply with what's easier for you. — TN Appliance`;
      return {
        success: true,
        is_draft: true,
        sent: false,
        draft_message: draft,
        note: 'This is a DRAFT only. Customer should confirm earlier-arrival works before tech reroutes — some customers can\'t accommodate an early arrival.',
      };
    }

    case 'load_relevant_notes': {
      const scope = String(ti.scope || '').toLowerCase();
      const scopeId = ti.scope_id || 0;
      const daysBack = Math.min(ti.days_back || 90, 365);
      const limit = Math.min(ti.limit || 10, 30);
      if (!scope) return { error: 'scope required' };
      if (scope !== 'global' && !scopeId) return { error: 'scope_id required for non-global scope' };
      // Pull recent brain_session_note rows and filter in app code by
      // scope + scope_id. Cheap because notes are sparse.
      const params = new URLSearchParams({ action: 'brain_session_note', days_back: String(daysBack), limit: '300' });
      const res = await timedFetch(`${XANO_BASE}/list_recent_event_log?${params.toString()}`, { method: 'GET' });
      if (res.error) return res;
      const rows = Array.isArray(res.items) ? res.items : [];
      const matches = [];
      for (const row of rows) {
        let meta;
        try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata; }
        catch (_) { continue; }
        if (!meta) continue;
        if (String(meta.scope || '').toLowerCase() !== scope) continue;
        if (scope !== 'global' && Number(meta.scope_id || 0) !== Number(scopeId)) continue;
        matches.push({
          note: meta.note,
          confidence: meta.confidence || 'medium',
          saved_at_ms: meta.saved_at_ms || row.created_at,
          source_brain: meta.brain || 'unknown',
        });
        if (matches.length >= limit) break;
      }
      return {
        ok: true,
        scope,
        scope_id: scopeId,
        notes_found: matches.length,
        notes: matches,
        guidance: matches.length === 0
          ? 'No prior notes for this entity. If you learn something durable this session, save it via save_session_note.'
          : 'Use these notes to inform your reply. If you learn something new + durable, save it via save_session_note.',
      };
    }

    case 'flag_capability_gap': {
      // Universal escalation surface. Architect reads these events
      // daily and proposes new agents/tools to fill the gap.
      const payload = {
        brain: String(ti.brain || 'unknown'),
        user_request: String(ti.user_request || '').slice(0, 1500),
        gap_description: String(ti.gap_description || '').slice(0, 1500),
        proposed_solution: String(ti.proposed_solution || '').slice(0, 1500),
        ctx_tech_id: ctx.tech_id || null,
        ctx_job_id: ctx.job_id || null,
        ctx_customer_id: ctx.customer_id || null,
        flagged_at_ms: Date.now(),
      };
      await timedFetch(`${XANO_BASE}/record_event_log`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'brain_capability_gap',
          metadata_json: JSON.stringify(payload),
        }),
      });
      return {
        ok: true,
        message: 'Gap logged. Teddy will see this in the weekly architect digest.',
      };
    }

    case 'save_session_note': {
      // Durable memory write. The retrieval layer (Phase 2) will load
      // recent notes per entity at brain session start.
      const payload = {
        brain: String(ti.brain || 'unknown'),
        scope: String(ti.scope || 'global'),
        scope_id: ti.scope_id || 0,
        note: String(ti.note || '').slice(0, 1000),
        confidence: String(ti.confidence || 'medium'),
        saved_at_ms: Date.now(),
      };
      if (!payload.note) return { error: 'note required' };
      await timedFetch(`${XANO_BASE}/record_event_log`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'brain_session_note',
          metadata_json: JSON.stringify(payload),
        }),
      });
      return { ok: true, message: 'Saved.' };
    }

    case 'record_brain_observation': {
      // Cross-brain context bus write. Other brains will see this when
      // they call load_brain_observations for the same entity.
      const payload = {
        source_brain: String(ti.source_brain || 'unknown'),
        entity_type: String(ti.entity_type || ''),
        entity_id: String(ti.entity_id || ''),
        observation: String(ti.observation || '').slice(0, 500),
        weight: ['low', 'medium', 'high'].includes(String(ti.weight)) ? String(ti.weight) : 'medium',
        topic: String(ti.topic || ''),
        expires_at_ms: Number(ti.expires_at_ms || 0),
      };
      if (!payload.entity_type || !payload.entity_id || !payload.observation) {
        return { error: 'entity_type, entity_id, observation required' };
      }
      try {
        const r = await timedFetch(`${XANO_BASE}/record_brain_observation`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (!r.ok) return { error: `record_brain_observation ${r.status}` };
        return { ok: true, message: 'Observation logged for other brains.' };
      } catch (e) {
        return { error: 'record_brain_observation failed: ' + (e.message || e) };
      }
    }

    case 'load_brain_observations': {
      const entityType = String(ti.entity_type || '');
      const entityId = String(ti.entity_id || '');
      if (!entityType || !entityId) return { error: 'entity_type + entity_id required' };
      const params = new URLSearchParams({
        entity_type: entityType,
        entity_id: entityId,
        days_back: String(ti.days_back || 14),
        limit: String(Math.min(Number(ti.limit || 10), 30)),
      });
      if (ti.topic) params.append('topic', String(ti.topic));
      try {
        const r = await timedFetch(`${XANO_BASE}/list_brain_observations?${params.toString()}`);
        if (!r.ok) return { error: `list_brain_observations ${r.status}` };
        const data = await r.json();
        const rows = (data.items || []).map((row) => {
          let meta = {};
          try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}); }
          catch (_) { meta = {}; }
          return {
            id: row.id,
            recorded_at_ms: meta.recorded_at_ms || row.created_at_ms,
            source_brain: meta.source_brain,
            observation: meta.observation,
            weight: meta.weight,
            topic: meta.topic,
          };
        });
        return {
          items: rows,
          count: rows.length,
          hint: rows.length === 0
            ? 'No cross-brain observations for this entity. Make your own judgment + record_brain_observation if you learn something other brains need.'
            : 'Use these observations to inform your reply. Higher weight = stronger signal.',
        };
      } catch (e) {
        return { error: 'load_brain_observations failed: ' + (e.message || e) };
      }
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

// ─── UNIVERSAL TOOLS ──────────────────────────────────────────────────
// Available to every brain. flag_capability_gap is the escalation
// surface — when Claude hits a request it can't fulfill with its
// current toolset, it calls this and the architect agent reads the
// gaps daily and proposes new agents/tools to fill them.
// save_session_note writes a durable observation into event_log; the
// memory retrieval layer (Phase 2) reads recent notes per entity at
// session start so each brain learns over time.
const UNIVERSAL_TOOLS = [
  {
    name: 'flag_capability_gap',
    description: "When you receive a request that you CANNOT complete with your current tools, call this. Don't apologize or pretend you can — record the gap so we can build the missing capability. Use sparingly: only when no combination of existing tools would work. NOT for things you SHOULDN'T do (policy violations) — only for things you CAN'T do (missing data source, missing endpoint, etc.).",
    input_schema: {
      type: 'object',
      properties: {
        brain: { type: 'string', description: 'Which brain reported this: tech_assist | tech_scheduler | office_ant | customer_ant | website_ant' },
        user_request: { type: 'string', description: 'What the user asked for, in their words.' },
        gap_description: { type: 'string', description: 'What capability is missing? Be specific. "Need a tool to look up part stock at Marcone" not "need parts info".' },
        proposed_solution: { type: 'string', description: 'Optional — your best guess at what tool / endpoint / agent would fill the gap.' },
      },
      required: ['brain', 'user_request', 'gap_description'],
    },
  },
  {
    name: 'load_relevant_notes',
    description: "Load durable observations from past sessions that match the current entity. Call this at the start of a non-trivial conversation (about a specific customer, tech, or warranty company) to see what prior brains learned. Returns recent brain_session_note rows scoped to the entity. Saves you from re-asking the user something we already know.",
    input_schema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'Which entity to look up: customer | tech | warranty_company | global' },
        scope_id: { type: 'integer', description: 'ID of the entity (customer_id, tech_id, etc.) — required for non-global scopes' },
        days_back: { type: 'integer', description: 'How far back to look (default 90)' },
        limit: { type: 'integer', description: 'Max notes to return (default 10, max 30)' },
      },
      required: ['scope'],
    },
  },
  {
    name: 'save_session_note',
    description: "Save a durable, factual observation from this session that future brain sessions could benefit from knowing. Examples: 'Customer Smith prefers afternoon appointments', 'Jimmy doesn't like working Saturdays', 'AHS now requires serial photo for sealed-system claims'. NOT chat history — only durable insights. Future brain sessions will see notes matching the current entity (tech, customer, job).",
    input_schema: {
      type: 'object',
      properties: {
        brain: { type: 'string', description: 'Which brain wrote this' },
        scope: { type: 'string', description: 'Entity this note attaches to: customer | tech | warranty_company | global' },
        scope_id: { type: 'integer', description: 'ID of the entity (customer_id, tech_id, etc.) — omit for global notes' },
        note: { type: 'string', description: 'The observation, 1-2 sentences max. Factual, durable, future-useful.' },
        confidence: { type: 'string', description: 'Optional: high | medium | low — how confident in this note' },
      },
      required: ['brain', 'scope', 'note'],
    },
  },
  {
    name: 'record_brain_observation',
    description: "CROSS-BRAIN context bus. Different from save_session_note — that's YOUR durable memory; this is a SHORT-TERM signal for OTHER brains working on the same entity right now. Examples: Tech Assist sees customer hostile → other brains should soften tone. Scheduler sees tech running 90min behind → Tech Assist should not push complex diagnostics today. Office notices AHS rejection-rate spiked → Tech Assist should pre-collect extra fields. Use weight='high' for things other brains MUST factor in; 'medium' for context; 'low' for FYI.",
    input_schema: {
      type: 'object',
      properties: {
        source_brain: { type: 'string', description: 'Which brain noticed it: tech_assist | tech_scheduler | office_ant | customer_ant | website_ant' },
        entity_type: { type: 'string', description: 'customer | job | tech | warranty_company' },
        entity_id: { type: 'string', description: 'ID of the entity (stringified — supports both numeric IDs and string keys like "AHS")' },
        observation: { type: 'string', description: 'Plain-text observation, 1-2 sentences. What did you notice that other brains need to know about this entity?' },
        weight: { type: 'string', description: 'low | medium | high — how strongly other brains should weight this' },
        topic: { type: 'string', description: 'Optional tag e.g. "tone" | "schedule_pressure" | "vendor_quirk"' },
        expires_at_ms: { type: 'integer', description: 'Optional auto-stale timestamp; omit for never' },
      },
      required: ['source_brain', 'entity_type', 'entity_id', 'observation'],
    },
  },
  {
    name: 'load_brain_observations',
    description: "Read recent observations OTHER brains noticed about the current entity. Call this at the start of any session involving a specific customer, tech, job, or warranty company — to see what your peer brains learned about them recently. Returns rows from the cross-brain context bus. Different from load_relevant_notes (which is YOUR own memory). Filter by topic if you only care about one thing (e.g. topic='tone' before composing a customer SMS).",
    input_schema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', description: 'customer | job | tech | warranty_company' },
        entity_id: { type: 'string', description: 'ID of the entity (stringified)' },
        topic: { type: 'string', description: 'Optional topic filter e.g. "tone"' },
        days_back: { type: 'integer', description: 'Default 14, max 60' },
        limit: { type: 'integer', description: 'Max rows; default 10' },
      },
      required: ['entity_type', 'entity_id'],
    },
  },
];

module.exports = {
  READ_TOOLS,
  SCHEDULER_TOOLS,
  WRITE_TOOLS,
  UNIVERSAL_TOOLS,
  ALL_TOOLS: [...READ_TOOLS, ...SCHEDULER_TOOLS, ...WRITE_TOOLS, ...UNIVERSAL_TOOLS],
  executeTool,
  pickTools,
  timedFetch,
  XANO_BASE,
};
