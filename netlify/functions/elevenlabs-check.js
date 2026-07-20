// elevenlabs-check — owner-gated. Confirms the ElevenLabs voiceover key is wired
// and shows the character quota.  GET ?secret=<VAPI_ADMIN_SECRET>[&voices=1]
'use strict';
const { getSecret } = require('./_lib/secrets');
const el = require('./_lib/elevenlabs');

function json(c, o) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o, null, 2) }; }

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { error: 'unauthorized' });
  const c = await el.check();
  if (!c.ok) {
    if (c.configured === false) return json(200, { connected: false, missing: c.missing, note: 'Get an API key at elevenlabs.io -> Profile -> API Keys, then add ELEVENLABS_API_KEY in admin-secrets.html.' });
    return json(200, { connected: false, error: c.error });
  }
  const out = { connected: true, tier: c.tier, characters_left: c.chars_left, ready_for_voiceover: true };
  if (q.voices === '1') { const v = await el.listVoices(); out.voices = v.voices || v.error; }
  return json(200, out);
};
