// Vision OCR Phase 4 — walkaround condition assessment.
//
// When a tech uploads a walkaround video at job start, the client
// extracts a still frame and sends it here. Claude Vision generates
// a structured baseline assessment of the customer's space + the
// appliance's exterior state.
//
// Purpose: ironclad damage documentation. If a customer later claims
// "you scratched my floor" or "the cabinet door was fine before you
// got here", we have a timestamped, AI-described baseline.
//
// Request:  POST { job_id, tech_id?, image_b64, purpose?, attachment_id? }
//   purpose: "walkaround_initial" | "walkaround_final" (default initial)
// Response: { success, assessment_text, damage_noted, cleanliness,
//             notable_items, confidence }

const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

const PROMPT = `You're an experienced appliance-repair technician documenting the customer's space BEFORE you start work. Your job: create a defensive baseline so if anyone later disputes condition, we have an objective record.

Analyze this image of the customer's home where the appliance repair will happen. Note:
- Pre-existing damage (scratches, dents, chipped paint, water stains, broken trim)
- Visible debris, mess, or hazards
- Notable items near the work zone (rugs, vases, electronics, pets, food)
- Floor type and general condition
- Appliance exterior state if visible
- Overall cleanliness

Be FACTUAL. Don't editorialize about the customer's housekeeping. Just describe what you observe so we can point to this record later if needed.

Return STRICT JSON:
{
  "assessment_text": "2-3 sentence factual baseline. Example: 'Kitchen with vinyl flooring in good condition. Refrigerator exterior shows minor scratch on right door panel near handle, approximately 4 inches long. Area in front of fridge is clear except for a small throw rug to the left.'",
  "damage_noted": ["list of specific pre-existing damage items, each a brief phrase like 'scratch on right door panel'"],
  "cleanliness": "clean | normal | cluttered | very_cluttered",
  "notable_items": ["list of items the tech should be careful around, like 'glass vase on counter', 'small dog visible'"],
  "confidence": "high | medium | low"
}

If the image is clearly NOT a walkaround scene (it's just a model sticker, a part close-up, a damaged appliance interior, a person face, food, anything other than a wide view of the work area), return:
{"assessment_text": "Image not suitable for walkaround baseline.", "damage_noted": [], "cleanliness": "unknown", "notable_items": [], "confidence": "low"}`;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return cors({ statusCode: 200, body: '' });
  if (event.httpMethod !== 'POST') return cors({ statusCode: 405, body: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return cors({ statusCode: 400, body: JSON.stringify({ error: 'bad json' }) }); }

  const { job_id, tech_id, image_b64, purpose, attachment_id } = body;
  if (!job_id || !image_b64) {
    return cors({ statusCode: 400, body: JSON.stringify({ error: 'job_id + image_b64 required' }) });
  }
  // Strip data URL prefix if present
  const b64 = String(image_b64).replace(/^data:image\/[a-z]+;base64,/, '');

  let extracted;
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok || !data.content) {
      throw new Error('claude api: ' + JSON.stringify(data).slice(0, 200));
    }
    const raw = String(data.content[0]?.text || '');
    const clean = raw.replace(/```json|```/g, '').trim();
    extracted = JSON.parse(clean);
  } catch (err) {
    return cors({ statusCode: 502, body: JSON.stringify({ error: 'vision failed: ' + err.message }) });
  }

  // Persist to Xano regardless of result so we have audit trail.
  try {
    await fetch(`${XANO_BASE}/save_walkaround_assessment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: Number(job_id),
        technician_id: tech_id ? Number(tech_id) : null,
        purpose: String(purpose || 'walkaround_initial'),
        assessment_text: String(extracted.assessment_text || ''),
        damage_noted: (extracted.damage_noted || []).join(' · '),
        cleanliness: String(extracted.cleanliness || 'unknown'),
        notable_items: (extracted.notable_items || []).join(' · '),
        confidence: String(extracted.confidence || 'medium'),
        attachment_id: attachment_id ? Number(attachment_id) : null,
      }),
    });
  } catch (_) {}

  return cors({
    statusCode: 200,
    body: JSON.stringify({ success: true, ...extracted }),
  });
};

function cors(resp) {
  return {
    ...resp,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...(resp.headers || {}),
    },
  };
}
