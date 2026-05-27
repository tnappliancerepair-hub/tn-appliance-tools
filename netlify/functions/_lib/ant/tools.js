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

// ─── SCHEDULER TOOLS (placeholders — wire next session) ─────────────
const SCHEDULER_TOOLS = [
  // Reserved for: set_tech_preference, set_off_day, find_open_slot,
  // check_conflicts, offer_extra_work. Tools added here will be safe
  // for office brain to use immediately; tech brain only if we want
  // techs to self-serve.
];

// ─── WRITE TOOLS (gated — only office brain exposes these) ──────────
const WRITE_TOOLS = [
  // Reserved for: schedule_job, reschedule_job, reassign_tech,
  // cancel_job, draft_warranty_submission, send_customer_sms_gated.
  // Each must include a "dry_run" parameter that defaults true so
  // Claude can preview the action before committing.
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
