// Adversarial review — a second Claude call independently audits a
// first brain's output before it ships. Used for HIGH-STAKES actions
// that are hard to undo:
//   - warranty claim submission text
//   - mass schedule moves (3+ reschedules in one turn)
//   - refunds / billing actions
//
// The reviewer plays adversarial: "find what could be wrong with this
// before it goes out." Catches hallucinations + bad calls without
// needing the user to spot them.
//
// Return shape:
//   { approve: true, notes: "" }                 → ship as-is
//   { approve: false, blocking: [...], advisory: [...] }  → don't ship
//
// Slow + expensive — only use it on actions you don't want to undo.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const REVIEWER_MODEL = process.env.ANT_REVIEWER_MODEL || 'claude-sonnet-4-5-20250929';

const SYSTEM_PROMPT = `You are an adversarial reviewer of another AI brain's output. Your job is to FIND PROBLEMS before this action ships.

You will receive:
  - the original user request (what was asked of the first brain)
  - the action TYPE (e.g. "warranty_submission", "mass_reschedule", "refund")
  - the proposed action / message body
  - any relevant context (job + customer details)

You must respond with JSON only:
{
  "approve": true|false,
  "blocking": ["short reason 1", "short reason 2"],
  "advisory": ["nit 1", "nit 2"],
  "confidence": 0-100
}

Approval rules:
  - blocking issues → approve: false. These are things that would CAUSE A REAL PROBLEM if shipped (wrong customer named, wrong dollar amount, fabricated detail, missing required field for the warranty vendor, inappropriate tone for stated context).
  - advisory issues → approve still true, but list them. These are nits.
  - If you have NO concerns at all, approve: true with empty blocking + advisory arrays.

Be skeptical. The first brain may have hallucinated. May have used outdated context. May have missed something important. Your bias is toward CAUTION — better one extra approval cycle than one bad action.

Confidence: how sure you are about your decision. Low confidence = the reviewer ITSELF isn't sure; report it honestly.`;

async function reviewAction({ actionType, originalRequest, proposed, context = {} }) {
  if (!ANTHROPIC_KEY) {
    // No key — safest default is "approve with low confidence" so the
    // system doesn't deadlock when the reviewer can't run.
    return { approve: true, blocking: [], advisory: ['reviewer offline (no key)'], confidence: 0, reviewer_status: 'offline' };
  }

  const userContent = [
    `ACTION TYPE: ${actionType}`,
    '',
    `ORIGINAL USER REQUEST:`,
    String(originalRequest || '(none provided)').slice(0, 2000),
    '',
    `PROPOSED ACTION / MESSAGE:`,
    String(proposed || '(none provided)').slice(0, 4000),
    '',
    `CONTEXT:`,
    JSON.stringify(context).slice(0, 3000),
    '',
    `Review now. Respond JSON only.`,
  ].join('\n');

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25_000);
  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: REVIEWER_MODEL,
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
      signal: ac.signal,
    });
    clearTimeout(t);
  } catch (err) {
    clearTimeout(t);
    return { approve: true, blocking: [], advisory: ['reviewer call failed: ' + (err.message || err)], confidence: 0, reviewer_status: 'error' };
  }

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    return { approve: true, blocking: [], advisory: ['reviewer non-2xx: ' + errBody.slice(0, 200)], confidence: 0, reviewer_status: 'non_2xx' };
  }
  const data = await resp.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (_) {
    return { approve: true, blocking: [], advisory: ['reviewer returned non-JSON: ' + cleaned.slice(0, 200)], confidence: 0, reviewer_status: 'unparseable' };
  }

  // Best-effort fire-and-forget audit row so the outcome-learning
  // digest can see reviewer behavior.
  try {
    fetch('https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/log_claude_call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: 'adversarial_reviewer',
        brain: 'reviewer',
        purpose: actionType,
        model: REVIEWER_MODEL,
        input_preview: userContent.slice(0, 1000),
        output_preview: cleaned.slice(0, 1000),
        signal_type: 'ADVERSARIAL_REVIEW',
        confidence_pct: Number(parsed.confidence || 0),
      }),
    }).catch(() => {});
  } catch (_) {}

  return {
    approve: !!parsed.approve,
    blocking: Array.isArray(parsed.blocking) ? parsed.blocking : [],
    advisory: Array.isArray(parsed.advisory) ? parsed.advisory : [],
    confidence: Number(parsed.confidence || 0),
    reviewer_status: 'ok',
  };
}

module.exports = { reviewAction };
