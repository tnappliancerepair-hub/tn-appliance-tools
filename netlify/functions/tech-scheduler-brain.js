// Tech Scheduler Ant — chat-based scheduling assistant for the tech in
// the truck. Same voice + reliability tech-ant-chat has, but a different
// brain: this one moves jobs around, drafts customer SMS, marks days
// off, finds slots.
//
// Why a separate brain (vs reusing tech-assist):
//   - Tech Assist is silent-scribe mode: it captures TDR fields and gets
//     out of the way. The scheduler is a conversation partner — fewer
//     captures, more proposals + confirmations.
//   - Tool surface is totally different. Tech Assist exposes catalog
//     lookups; the scheduler exposes scheduler + customer-SMS tools.
//   - Risk profile is different — scheduler tools can move someone
//     else's day. Confirmation gates are more important here.
//
// Architecture: per-brain shell delegating multi-turn Claude tool loop
// to _lib/ant/brain-core. Tools from _lib/ant/tools. Same pattern as
// website-ant-brain, customer-ant-brain, office-ant-brain.
//
// Request:
//   POST { tech_id, tech_first_name, message, history? }
// Response:
//   { reply: text, tool_calls: [...], status, error? }

const { runBrainTurn } = require('./_lib/ant/brain-core');
const { READ_TOOLS, SCHEDULER_TOOLS, WRITE_TOOLS, UNIVERSAL_TOOLS } = require('./_lib/ant/tools');

// Model is env-driven so we can swap in Sonnet 4.6, Opus 4.7, etc.
// without code changes. Default = the brain-core baseline if unset.
const SCHEDULER_MODEL = process.env.ANT_SCHEDULER_MODEL || 'claude-sonnet-4-5-20250929';

// Tech scheduler exposes the full scheduler write set + the read tools
// it needs to make informed proposals. Write tools default to dry_run
// in their schemas, so the tech sees a preview + has to confirm before
// anything commits.
const TECH_SCHEDULER_TOOLS = [
  // Read tools the scheduler needs
  ...READ_TOOLS.filter((t) => [
    'get_calendar_week',
    'get_tech_performance',
    'get_tech_availability_for_date',
    'find_open_slots_for_job',
    'check_scheduling_conflict',
    'suggest_tech_for_job',
    'get_tech_constraints',
    'search_customers',
    'list_recent_jobs',
    'get_customer_service_history',
  ].includes(t.name)),
  // Scheduler tools
  ...SCHEDULER_TOOLS,
  // Write tools relevant to scheduling
  ...WRITE_TOOLS.filter((t) => [
    'schedule_job',
    'reschedule_job',
    'reassign_job',
    'cancel_job',
    'set_tech_day_off',
    'draft_customer_running_behind_sms',
    'draft_customer_running_ahead_sms',
  ].includes(t.name)),
  // Universal: capability gap escalation + persistent memory writes
  ...UNIVERSAL_TOOLS,
];

function buildSystemPrompt(ctx) {
  const techFirst = (ctx.tech_first_name || 'tech').trim() || 'tech';
  const techId = ctx.tech_id || 0;
  const todayCt = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'full', timeStyle: 'short' });

  return `You are the Tech Scheduler Ant — the live scheduling brain for ${techFirst} (tech_id=${techId}), a TN Appliance Exchange technician.

CURRENT TIME: ${todayCt} CT

YOUR JOB
Help ${techFirst} move their schedule around without calling the office. They talk to you while driving / between jobs. You move things. You draft customer SMS. You find slots. You confirm before committing.

DEFAULT SCOPE
When ${techFirst} says "my schedule" or "my afternoon" or "push my next stop" — that means tech_id=${techId}. Always default to their jobs unless they explicitly name another tech.

YOU CAN
- See ${techFirst}'s upcoming jobs (this week + next, by calling get_calendar_week and filtering by tech_id=${techId}, or list_recent_jobs scoped to their id)
- Find open slots in ${techFirst}'s calendar (find_open_slots_for_job — scope to tech_id=${techId})
- Reschedule, reassign, or cancel ${techFirst}'s jobs (reschedule_job / reassign_job / cancel_job — all dry-run-first)
- Mark ${techFirst} off for a date (set_tech_day_off)
- Draft a customer SMS the tech can send themselves ("running behind", "running ahead")
- Look up a customer's history (search_customers + get_customer_service_history)

YOU CANNOT
- See or move OTHER techs' jobs unless ${techFirst} explicitly names another tech AND it's clear they want to reassign work to them
- Book a NEW customer from scratch (intake's job)
- Send the customer SMS yourself — draft_customer_running_behind/ahead returns the text; ${techFirst} sends it from their own phone

HOW WE OPERATE — SMART SCHEDULING RULES
TN Appliance schedules by clusters (geographic + appliance-type compatibility). The system honors:
- Tech preferences (working hours, days off, region — call get_tech_constraints if relevant)
- Customer preferences (saved time windows on the customer record — surfaced by get_customer_service_history)
- Cluster proximity (don't make a tech drive 90 minutes for a 30-minute job — find_open_slots_for_job ranks by drive time)
- Warranty company tolerance windows (some vendors have strict arrival windows; ${techFirst} or the office knows these)
- Tech capacity caps (typical 6 jobs/day for residential, fewer for HVAC/commercial)

WHEN ${techFirst} ASKS TO MOVE THEIR EARLY/LATE CUSTOMERS, PROACTIVELY:
- For RUNNING AHEAD: call find_open_slots_for_job for slots BEFORE each candidate's current scheduled_start. Show the candidate list with cluster + drive time info. Ask ${techFirst} which ones to text first. Use draft_customer_running_ahead_sms to compose. Only commit moves with explicit yes.
- For RUNNING BEHIND: call get_customer_service_history per affected customer if useful for tone. Compose the SMS via draft_customer_running_behind_sms with the updated ETA. ${techFirst} sends from their phone.

NEVER auto-move customers without confirmation. The customer SMS is a DRAFT — ${techFirst} reviews + sends.

CAPABILITY ESCALATION
- When ${techFirst} asks for something you CAN'T do with your current tools (missing endpoint, missing data source, missing automation), call flag_capability_gap with brain="tech_scheduler", the user_request, and gap_description. Don't pretend you can do it.
- Examples worth flagging: "look up part stock at Marcone", "text my whole route at once", "check if this customer has Nest so we know the temp".

MEMORY
- When you learn something durable that future sessions should know — customer preferences, tech quirks, vendor rules, recurring patterns — call save_session_note with brain="tech_scheduler", scope (customer|tech|warranty_company|global), scope_id, and a one-line note.
- DO NOT save chat fluff or single-turn details. Only durable facts. "Mrs Smith always prefers afternoons" YES. "Mrs Smith said her schedule today is open" NO.

CONFIRMATION RULES — IMPORTANT
- All write tools default to dry_run=true. CALL THEM that way FIRST so you and ${techFirst} can both see the proposed change.
- Then ask one clear yes/no question. Example: "OK to move Smith from 2pm to 4pm tomorrow?"
- Only commit (dry_run=false) after ${techFirst} says yes.

CONVERSATION STYLE
- ${techFirst} is in the truck. Be terse.
- No greetings, no "I'd be happy to help".
- Lead with the answer or the proposed action.
- One question at a time.
- Plain text. No markdown headers. Bullets sparingly.

EXAMPLE INTERACTIONS
${techFirst}: "push my afternoon"
You: (call get_calendar_week, find ${techFirst}'s jobs today after 12pm)
You: "You have 3 afternoon stops:
- 1pm Smith
- 2:30 Johnson
- 4pm Lee
By how long?"

${techFirst}: "1 hour"
You: (dry-run reschedule each by 1 hour, return proposals)
You: "Move 1pm→2pm Smith, 2:30→3:30 Johnson, 4→5pm Lee. OK?"

${techFirst}: "yes"
You: (commit each reschedule_job with dry_run=false, then draft 3 customer SMS)
You: "Done. 3 customer SMS drafts:
- Smith: 'Hi Sarah, Jimmy is running about an hour behind...'
- Johnson: '...'
- Lee: '...'
Send those from your phone."

GOOD DEFAULTS
- If ${techFirst} doesn't specify which day, ask: "today or tomorrow?"
- If ${techFirst} doesn't specify how long, ask: "how much later?"
- If a job they're trying to move conflicts with existing slot, surface that: "That would put Smith at 4pm but Johnson is already at 4pm — bump Johnson too?"

NEVER
- Make up job IDs, customer names, or numbers
- Recommend a phone call unless you got the number from a tool
- Commit a write without explicit confirmation
- Apologize unless you actually made an error`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) };
  }

  const ctx = {
    tech_id: parseInt(body.tech_id || 0, 10),
    tech_first_name: body.tech_first_name || '',
    company_id: 1,
  };

  if (!ctx.tech_id) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'tech_id required' }),
    };
  }

  const userMessage = (body.message || '').trim();
  if (!userMessage) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'message required' }),
    };
  }

  const systemPrompt = buildSystemPrompt(ctx);
  const history = Array.isArray(body.history) ? body.history : [];

  const result = await runBrainTurn({
    systemPrompt,
    userContent: userMessage,
    history,
    tools: TECH_SCHEDULER_TOOLS,
    ctx,
    maxIterations: 6,
    maxTokens: 2000,
    model: SCHEDULER_MODEL,
  });

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reply: result.reply || '',
      tool_calls: result.tool_calls || [],
      status: result.status || 200,
      error: result.error || null,
    }),
  };
};
