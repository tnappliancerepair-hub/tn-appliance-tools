// Extracts TDR fields from a tech-ant-live transcript via Claude Haiku.
// Called on-demand from the tech-ant-live 'Auto-fill TDR' button.
// Synchronous (returns extracted JSON in the response) so the UI can
// populate the form immediately.
//
// ENV: ANTHROPIC_API_KEY required.

const SYSTEM_PROMPT = `You extract TDR fields from a technician's repair notes / repair-chat transcript. Output STRICT JSON, no commentary, no markdown fence:
{
  "diagnosis": "...",        // 1-2 sentence root-cause diagnosis of what's wrong
  "failure_cause": "...",    // single phrase (e.g. "compressor failure", "clogged drain")
  "failed_component": "...", // the failed part in plain words AND its OEM part number if the tech gave one, e.g. "dispenser cover assembly (DA97-19112C)". The part number belongs HERE with the failed part.
  "part_number": "...",      // the same OEM/manufacturer part number on its own if the tech wrote one (e.g. "DC97-16350C"). "" if none.
  "repair_completed": "...", // 1-2 sentences of what was DONE, or the plan if returning (e.g. "waiting on the part, will return to install"). Do NOT put the failed part's number here — it goes in failed_component.
  "labor_time_hours": 0.0,   // decimal hours best estimate if stated
  "confidence": 0.0          // 0-1 overall extraction confidence
}
Empty string ("") or 0 when unknown. NEVER fabricate a part number or diagnosis — only pull what the tech actually wrote. Use the tech's own words. Notes may be terse shorthand; interpret sensibly.`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResp(400, { ok: false, error: 'invalid_json' }); }

  const transcript = String(body.transcript || '').trim();
  if (!transcript) return jsonResp(400, { ok: false, error: 'transcript required' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return jsonResp(500, { ok: false, error: 'no_api_key' });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Transcript:\n\n${transcript.slice(0, 8000)}\n\nReturn ONLY the JSON.` }],
      }),
    });
    const data = await resp.json();
    const txt = String((data && data.content && data.content[0] && data.content[0].text) || '').trim();
    const cleaned = txt.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    let extracted;
    try { extracted = JSON.parse(cleaned); }
    catch (e) {
      return jsonResp(500, { ok: false, error: 'parse_failed', raw: cleaned.slice(0, 500) });
    }
    return jsonResp(200, { ok: true, extracted });
  } catch (err) {
    return jsonResp(500, { ok: false, error: err.message });
  }
};

function jsonResp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
