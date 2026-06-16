const { getSecret } = require('./_lib/secrets');
// Whisper transcription — receives an audio file (multipart/form-data),
// forwards to OpenAI Whisper, returns the transcript.
//
// Why this and not iOS Safari's built-in webkitSpeechRecognition: the
// native one is unreliable (Teddy hit it failing this morning), only
// handles English well, and breaks on noisy environments. Whisper is
// the gold-standard ASR model.
//
// Caller (tech-ant-live.html toggleRecording): MediaRecorder captures
// audio → on stop, POST the blob here → get JSON {text, duration_sec}.
//
// Env: OPENAI_API_KEY (already in Netlify env, used by embed-text.js)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'POST only' };
  }
  const key = await getSecret('OPENAI_API_KEY');
  if (!key) {
    // Friendlier message so techs in the field see something useful instead
    // of a cryptic env-var error. Returns 200 with ok=false so the client
    // shows the friendly text instead of "transcribe failed: ..." red box.
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        unavailable: true,
        error: "Voice typing isn't turned on yet — type your finding instead. We'll have voice live soon.",
      }),
    };
  }

  const contentType = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
  if (!contentType.startsWith('multipart/form-data')) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'expected multipart/form-data with "audio" field' }),
    };
  }

  // Decode body — Netlify passes base64-encoded body when isBase64Encoded=true
  let bodyBuf;
  try {
    bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body || '', 'binary');
  } catch (err) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'failed to decode body: ' + err.message }),
    };
  }

  // Forward as-is to OpenAI Whisper. We re-build the multipart with our own
  // boundary so we can add Whisper-specific fields (model, response_format).
  // Easier: parse the incoming audio field, then re-multipart it.
  // Even easier: since the caller controls the multipart format, we just
  // pass the entire body through, replacing the content-type header.
  // BUT — Whisper API expects a specific multipart format with 'file' field
  // (not 'audio'). So we need to wrap.

  // Parse out the audio bytes from the multipart body.
  const boundaryMatch = contentType.match(/boundary=([^;]+)/);
  if (!boundaryMatch) {
    return { statusCode: 400, body: JSON.stringify({ error: 'no boundary in content-type' }) };
  }
  const boundary = boundaryMatch[1].trim().replace(/^"|"$/g, '');
  const parts = parseMultipart(bodyBuf, boundary);
  const audioPart = parts.find((p) => p.name === 'audio' || p.name === 'file');
  if (!audioPart) {
    return { statusCode: 400, body: JSON.stringify({ error: 'no "audio" or "file" field found in multipart body' }) };
  }

  // Build a fresh multipart with the field name "file" (Whisper's contract)
  const newBoundary = '----whispernode' + Date.now() + Math.random().toString(36).slice(2, 8);
  const segments = [];
  segments.push(Buffer.from(`--${newBoundary}\r\n`));
  segments.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${audioPart.filename || 'audio.webm'}"\r\n`));
  segments.push(Buffer.from(`Content-Type: ${audioPart.contentType || 'audio/webm'}\r\n\r\n`));
  segments.push(audioPart.data);
  segments.push(Buffer.from(`\r\n--${newBoundary}\r\n`));
  segments.push(Buffer.from(`Content-Disposition: form-data; name="model"\r\n\r\nwhisper-1`));
  segments.push(Buffer.from(`\r\n--${newBoundary}\r\n`));
  segments.push(Buffer.from(`Content-Disposition: form-data; name="response_format"\r\n\r\njson`));
  segments.push(Buffer.from(`\r\n--${newBoundary}--\r\n`));
  const newBody = Buffer.concat(segments);

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': `multipart/form-data; boundary=${newBoundary}`,
      },
      body: newBody,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return {
        statusCode: res.status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: `whisper api ${res.status}: ${txt.slice(0, 300)}` }),
      };
    }
    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        text: (data.text || '').trim(),
        duration_sec: data.duration || null,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'transcribe fetch failed: ' + (err.message || String(err)) }),
    };
  }
};

// Minimal multipart parser — enough for one or two text/file fields. Not
// production-grade; for richer needs, use 'busboy' npm package.
function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = [];
  let pos = 0;
  while (pos < buffer.length) {
    const start = buffer.indexOf(boundaryBuf, pos);
    if (start === -1) break;
    const headerStart = start + boundaryBuf.length;
    // Check for end-of-multipart marker "--"
    if (buffer.slice(headerStart, headerStart + 2).toString() === '--') break;
    // Skip CRLF after boundary
    const headerLineStart = headerStart + 2;  // skip \r\n
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerLineStart);
    if (headerEnd === -1) break;
    const headersText = buffer.slice(headerLineStart, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundaryBuf, dataStart);
    if (nextBoundary === -1) break;
    const data = buffer.slice(dataStart, nextBoundary - 2);  // -2 for \r\n before boundary
    // Parse headers
    const nameMatch = headersText.match(/name="([^"]+)"/);
    const filenameMatch = headersText.match(/filename="([^"]+)"/);
    const ctMatch = headersText.match(/Content-Type:\s*([^\r\n]+)/i);
    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: filenameMatch ? filenameMatch[1] : null,
        contentType: ctMatch ? ctMatch[1].trim() : null,
        data,
      });
    }
    pos = nextBoundary;
  }
  return parts;
}
