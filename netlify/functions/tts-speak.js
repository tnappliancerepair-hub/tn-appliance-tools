const { getSecret } = require('./_lib/secrets');
// OpenAI TTS — converts Ant's text reply into a natural-sounding voice.
// Returns audio/mpeg bytes so the frontend can play() it via an <audio>
// element (or Web Audio API).
//
// Why this and not browser SpeechSynthesis: native voices vary wildly
// (Samantha is OK on iOS, robotic on Android). OpenAI TTS is consistent
// and sounds like a person. ~$0.015/1k chars, so a typical 150-char
// Ant reply is ~$0.002. At 6 techs × 50 replies/day = ~$1.80/month.
//
// Env: OPENAI_API_KEY (shared with whisper-transcribe + embed-text).
//
// Request: POST { text, voice? }  →  Response: audio/mpeg bytes
// voices: alloy (neutral) · nova (energetic female) · shimmer (warm female)
//         echo (calm male) · onyx (deep male) · fable (British)
// Default: nova — feels alive + present, matches the field-partner vibe.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  const key = await getSecret('OPENAI_API_KEY');
  if (!key) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, unavailable: true, error: 'OPENAI_API_KEY not configured' }),
    };
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) {
    return { statusCode: 400, body: JSON.stringify({ error: 'bad json' }) };
  }
  const text = String(body.text || '').slice(0, 2000).trim();
  if (!text) {
    return { statusCode: 400, body: JSON.stringify({ error: 'text required' }) };
  }
  const allowedVoices = new Set(['alloy', 'nova', 'shimmer', 'echo', 'onyx', 'fable']);
  const voice = allowedVoices.has(String(body.voice || '').toLowerCase())
    ? String(body.voice).toLowerCase()
    : 'nova';
  const model = 'gpt-4o-mini-tts';

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20000);
  let resp;
  try {
    resp = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        response_format: 'mp3',
        speed: 1.05,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(t);
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'tts call failed: ' + (err.message || err) }),
    };
  }
  clearTimeout(t);

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'tts api ' + resp.status + ': ' + errBody.slice(0, 300) }),
    };
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  return {
    statusCode: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'no-store',
    },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};
