// Tech Ant Assist brain — Claude with tools for the in-the-field tech.
// Default role: silent scribe (extracts TDR fields from anything texted,
// answers questions only when the data warrants).
//
// Architecture (2026-05-27 refactor): per-brain shell that delegates the
// multi-turn Claude tool-calling loop to _lib/ant/brain-core. Tools come
// from _lib/ant/tools — this brain picks the READ_TOOLS subset that
// makes sense in a tech context (no calendar overview, no full pulse).
//
// Caller (tech_sms_assist_POST.xs) sends:
//   { tech_id, tech_first_name, job_id, customer_id, brand, appliance,
//     problem, existing_captured, message, media_urls? }
// Returns:
//   { ok, reply, captured, tool_calls, status }

const { runBrainTurn, tryParseJsonReply } = require('./_lib/ant/brain-core');
const { READ_TOOLS, UNIVERSAL_TOOLS, pickTools } = require('./_lib/ant/tools');

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

// Tech-side tool subset. Customer history + model failures = directly
// useful while diagnosing. Intelligence reads added 2026-05-28:
//   get_pre_job_intelligence (#5) — overnight-staged context for THIS job
//   get_warranty_vendor_fingerprint (#4) — what THIS vendor needs
// Plus UNIVERSAL bus reads so peer brains' observations land here too.
const TECH_TOOLS = [
  ...pickTools(READ_TOOLS, [
    'get_customer_service_history',
    'get_common_failures_for_model',
    'get_pre_job_intelligence',
    'get_warranty_vendor_fingerprint',
  ]),
  ...UNIVERSAL_TOOLS.filter((t) => ['flag_capability_gap', 'load_brain_observations', 'record_brain_observation'].includes(t.name)),
];

// Pre-fetch the staged intelligence + warranty fingerprint BEFORE
// calling Claude. Cuts a Claude turn on common cases — the data is
// already in the prompt rather than requiring a tool round-trip.
// Best-effort; failure just means the brain gets less ground truth.
async function prefetchIntel({ job_id, warranty_company }) {
  const out = { pre_job_intel: null, warranty_fingerprint: null };
  if (job_id) {
    try {
      const r = await fetch(`${XANO_BASE}/get_pre_job_intelligence?job_id=${job_id}`, { signal: AbortSignal.timeout(3500) });
      if (r.ok) {
        const d = await r.json();
        if (d && d.found && d.metadata) {
          try { out.pre_job_intel = typeof d.metadata === 'string' ? JSON.parse(d.metadata) : d.metadata; }
          catch (_) {}
        }
      }
    } catch (_) {}
  }
  if (warranty_company) {
    try {
      const r = await fetch(`${XANO_BASE}/get_warranty_vendor_fingerprint?vendor=${encodeURIComponent(warranty_company)}`, { signal: AbortSignal.timeout(3500) });
      if (r.ok) {
        const d = await r.json();
        if (d && d.found && d.metadata) {
          try { out.warranty_fingerprint = typeof d.metadata === 'string' ? JSON.parse(d.metadata) : d.metadata; }
          catch (_) {}
        }
      }
    } catch (_) {}
  }
  return out;
}

function buildSystemPrompt(ctx) {
  return `You are Ant, the silent scribe + smart teammate for an appliance-repair tech mid-job. Hands dirty, on the road. NOT a chatbot — you only speak when you have real value to add.

OUTPUT FORMAT: respond with valid JSON only, no markdown fence:
{"reply":"<under-250-char plain text or empty string>","captured":{"diagnosis":string?,"failed_component":string?,"verified_part_number":string?,"replaced_by_part_number":string?,"labor_hours":string?,"repair_completed":string?,"parts_status":string?,"recommendation":string?}}

TOOLS AVAILABLE: get_customer_service_history, get_common_failures_for_model. USE THEM when the data would change your reply:
- Tech says "this is the third time I've been here" → call get_customer_service_history
- Tech is diagnosing a tricky issue → call get_common_failures_for_model
- Tech asks "what does this customer usually have?" → call get_customer_service_history
DON'T call tools just to look smart — only when the data matters.

EXTRACTION RULES (every turn, parse the LATEST message for ALL fields):
- '1.5', '45 min', '1 hr', '2hrs' → labor_hours as decimal ('1.5', '0.75', '1', '2')
- 'replaced by #X' / 'sub X' / 'crossed to X' → replaced_by_part_number=X
- Part numbers like 'WPW10310240', '316455400' → verified_part_number
- 'all done' / 'fixed' / 'swapped' → recommendation='repair_complete' + repair_completed describing what they did
- 'parts ordered' / 'on order' → parts_status='ordered', recommendation='2nd_visit'
- 'Nwt' / 'NWT' → parts_status='needs_quote', recommendation='quote'

REPLY RULES (chat-led TDR gathering — 2026-05-28 update):
- The chat IS the TDR. Walk the tech through filling it conversationally.
- TECH'S FIRST MESSAGE in a session:
  • If no model number on file → ask "What's the model number? Snap the tag if easier — I'll read it." (≤120 chars)
  • If model present but no diagnosis → ask "What are you seeing?" + offer "Tap 📷 to send a failure photo."
- ALL 4 core fields present (diagnosis, failed_component, labor_hours, repair_completed) → reply: "TDR ready. Tap 📝 to review + save. Summary: <one sentence>."
- EXACTLY ONE core field missing → ask for ONLY that one, briefly. "Still need labor hours — how long did this take?"
- TWO+ missing → ask for the MOST important one first (diagnosis > failed_component > labor_hours > repair_completed). Don't dump a list.
- Tech asks part lookup → respond IMMEDIATELY with searspartsdirect.com/model/<MODEL>/parts link. NEVER promise to "look it up" — the link IS the deliverable.
- NEVER say "got it" / "keep going" / "text more findings" — if nothing to add, reply is empty string "".
- NEVER ask for a field already in 'Already captured'.
- Photos: when tech sends image, READ IT. Extract model/serial/part/error code. If you read a model number, confirm: "Got the model: WTW5000DW2. What's wrong with it?"

JOB CONTEXT: tech=${ctx.tech_first_name} job#${ctx.job_id} appliance=${ctx.brand} ${ctx.appliance} problem=${ctx.problem}
Already captured: ${JSON.stringify(ctx.existing_captured || {})}${renderPreJobIntel(ctx.pre_job_intel)}${renderWarrantyFingerprint(ctx.warranty_fingerprint)}`;
}

function renderPreJobIntel(intel) {
  if (!intel || !intel.summary) return '';
  return `\n\nPRE-JOB INTELLIGENCE (overnight-staged):\n${intel.summary}`;
}

function renderWarrantyFingerprint(fp) {
  if (!fp || !fp.vendor) return '';
  const lines = [`\n\nWARRANTY VENDOR FINGERPRINT (${fp.vendor}, ${fp.window_days || 60}d):`];
  if (fp.clear_rate_pct != null) lines.push(`  Clear rate: ${fp.clear_rate_pct}% (${fp.claims_count || 0} claims)`);
  if (fp.rejection_rate_pct != null) lines.push(`  Rejection rate: ${fp.rejection_rate_pct}%`);
  if (Array.isArray(fp.top_correction_fields) && fp.top_correction_fields.length > 0) {
    lines.push(`  Most-missed fields (front-load these):`);
    for (const f of fp.top_correction_fields.slice(0, 5)) {
      lines.push(`    • ${f.field} (rejected ${f.count}x)`);
    }
  }
  return lines.join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) };
  }

  const ctx = {
    tech_id: body.tech_id,
    tech_first_name: body.tech_first_name || '',
    job_id: body.job_id,
    customer_id: body.customer_id,
    brand: body.brand || '',
    appliance: body.appliance || 'appliance',
    problem: body.problem || '',
    warranty_company: body.warranty_company || '',
    existing_captured: body.existing_captured || {},
    // Entity-link fields for outcome-conditioned learning logging.
    brain: 'tech_assist',
    signal_type: 'TECH_SMS_ASSIST',
  };

  // Pre-fetch staged intelligence + vendor fingerprint in parallel.
  // Best-effort; failures fold into empty context blocks.
  try {
    const intel = await prefetchIntel({ job_id: ctx.job_id, warranty_company: ctx.warranty_company });
    ctx.pre_job_intel = intel.pre_job_intel;
    ctx.warranty_fingerprint = intel.warranty_fingerprint;
  } catch (_) {}

  // Build user content (text-only OR multi-part with image blocks for MMS).
  const mediaUrls = Array.isArray(body.media_urls)
    ? body.media_urls.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    : [];
  const textBody = (body.message || '').trim();
  let userContent;
  if (mediaUrls.length > 0) {
    userContent = mediaUrls.map((u) => ({ type: 'image', source: { type: 'url', url: u } }));
    if (textBody) {
      userContent.push({ type: 'text', text: textBody });
    } else {
      userContent.push({ type: 'text', text: '(Tech sent a photo with no caption — extract any visible model/serial/part/error code text and treat as TDR fields.)' });
    }
  } else {
    userContent = textBody;
  }

  const systemPrompt = buildSystemPrompt(ctx);
  const result = await runBrainTurn({
    systemPrompt,
    userContent,
    tools: TECH_TOOLS,
    ctx,
    maxIterations: 4,
    maxTokens: 1500,
    claudeTimeoutMs: 25_000,
  });

  // Tech-side scribe returns structured JSON {reply, captured}; parse it.
  const parsed = tryParseJsonReply(result.reply);

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: !result.error,
      reply: parsed.reply || '',
      captured: parsed.captured || {},
      tool_calls: result.tool_calls || [],
      status: result.status || 0,
      error: result.error || null,
    }),
  };
};
